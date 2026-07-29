import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

export interface SchematicRasterizerHandle {
  rasterizePdf: (base64Pdf: string) => Promise<string[]>;
  rasterizeSvg: (base64Svg: string) => Promise<string>;
}

const RASTERIZE_TIMEOUT_MS = 45000;

const RASTERIZER_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<style>html,body{margin:0;padding:0;background:#fff;}</style>
</head>
<body>
<script>
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  function post(msg) {
    window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  }

  function b64ToBytes(base64) {
    var raw = atob(base64);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }

  async function renderPdf(requestId, base64) {
    try {
      var bytes = b64ToBytes(base64);
      var pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      var pages = [];
      var maxPages = Math.min(pdf.numPages, 20);
      var TARGET_SCALE = 3.0;
      var MAX_DIMENSION = 3500;
      for (var p = 1; p <= maxPages; p++) {
        var page = await pdf.getPage(p);
        var baseViewport = page.getViewport({ scale: 1.0 });
        var scale = TARGET_SCALE;
        var longestSide = Math.max(baseViewport.width, baseViewport.height) * scale;
        if (longestSide > MAX_DIMENSION) {
          scale = MAX_DIMENSION / Math.max(baseViewport.width, baseViewport.height);
        }
        var viewport = page.getViewport({ scale: scale });
        var canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        var ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport: viewport }).promise;
        pages.push(canvas.toDataURL('image/jpeg', 0.92).split(',')[1]);
      }
      post({ requestId: requestId, type: 'result', pages: pages });
    } catch (e) {
      post({ requestId: requestId, type: 'error', message: String((e && e.message) || e) });
    }
  }

  function renderSvg(requestId, base64) {
    try {
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 1600;
        canvas.height = img.naturalHeight || 1200;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        post({ requestId: requestId, type: 'result', pages: [canvas.toDataURL('image/jpeg', 0.92).split(',')[1]] });
      };
      img.onerror = function () {
        post({ requestId: requestId, type: 'error', message: 'Failed to load SVG image' });
      };
      img.src = 'data:image/svg+xml;base64,' + base64;
    } catch (e) {
      post({ requestId: requestId, type: 'error', message: String((e && e.message) || e) });
    }
  }

  function onMessage(event) {
    try {
      var data = JSON.parse(event.data);
      if (data.type === 'pdf') renderPdf(data.requestId, data.base64);
      else if (data.type === 'svg') renderSvg(data.requestId, data.base64);
    } catch (e) {
      post({ type: 'error', message: 'Bad message: ' + String(e) });
    }
  }

  document.addEventListener('message', onMessage);
  window.addEventListener('message', onMessage);

  post({ type: 'ready' });
</script>
</body>
</html>`;

export const SchematicRasterizer = forwardRef<SchematicRasterizerHandle>((_props, ref) => {
  const webviewRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const pendingReady = useRef<(() => void)[]>([]);
  const pendingRequests = useRef<Map<string, { resolve: (v: string[]) => void; reject: (e: Error) => void }>>(new Map());
  const requestCounter = useRef(0);

  const waitForReady = () =>
    new Promise<void>((resolve) => {
      if (readyRef.current) resolve();
      else pendingReady.current.push(resolve);
    });

  const send = async (type: 'pdf' | 'svg', base64: string): Promise<string[]> => {
    await waitForReady();
    const requestId = String(++requestCounter.current);

    const result = new Promise<string[]>((resolve, reject) => {
      pendingRequests.current.set(requestId, { resolve, reject });
    });

    webviewRef.current?.postMessage(JSON.stringify({ type, base64, requestId }));

    const timeout = new Promise<string[]>((_, reject) => {
      setTimeout(() => {
        if (pendingRequests.current.delete(requestId)) {
          reject(new Error('Rasterization timed out. Check your internet connection and try again.'));
        }
      }, RASTERIZE_TIMEOUT_MS);
    });

    return Promise.race([result, timeout]);
  };

  useImperativeHandle(ref, () => ({
    rasterizePdf: (base64Pdf: string) => send('pdf', base64Pdf),
    rasterizeSvg: async (base64Svg: string) => {
      const pages = await send('svg', base64Svg);
      return pages[0];
    },
  }));

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'ready') {
        readyRef.current = true;
        pendingReady.current.forEach((resolve) => resolve());
        pendingReady.current = [];
        return;
      }
      const pending = data.requestId ? pendingRequests.current.get(data.requestId) : undefined;
      if (!pending) return;
      pendingRequests.current.delete(data.requestId);
      if (data.type === 'result') pending.resolve(data.pages);
      else pending.reject(new Error(data.message || 'Rasterization failed'));
    } catch (e) {
      console.error('[Rasterizer] Failed to parse WebView message', e);
    }
  };

  return (
    <View style={{ width: 0, height: 0, opacity: 0, position: 'absolute' }} pointerEvents="none">
      <WebView
        ref={webviewRef}
        originWhitelist={['*']}
        source={{ html: RASTERIZER_HTML }}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
      />
    </View>
  );
});

SchematicRasterizer.displayName = 'SchematicRasterizer';
