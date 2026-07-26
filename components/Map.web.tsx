import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';

export interface MapMarker {
    id: string;
    latitude: number;
    longitude: number;
    title?: string;
    description?: string;
}

interface MapProps {
    markers?: MapMarker[];
    initialRegion?: {
        latitude: number;
        longitude: number;
        latitudeDelta: number;
        longitudeDelta: number;
    };
    style?: ViewStyle;
    showsUserLocation?: boolean;
}

export const Map = ({
    markers = [],
    style,
    showsUserLocation = false
}: MapProps) => {
    return (
        <View style={[styles.container, style]}>
            <Text style={styles.title}>Map preview</Text>
            <Text style={styles.subtitle}>
                Web map rendering is not configured in this project yet.
            </Text>
            <Text style={styles.meta}>
                {markers.length} marker{markers.length === 1 ? '' : 's'}
                {showsUserLocation ? ' • user location enabled' : ''}
            </Text>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
        width: '100%',
        minHeight: 200,
        backgroundColor: '#e5e7eb',
        padding: 16,
    },
    title: {
        fontSize: 16,
        fontWeight: '600',
        color: '#111827',
        marginBottom: 6,
    },
    subtitle: {
        fontSize: 14,
        color: '#374151',
        textAlign: 'center',
        marginBottom: 8,
    },
    meta: {
        fontSize: 12,
        color: '#6b7280',
        textAlign: 'center',
    },
});
