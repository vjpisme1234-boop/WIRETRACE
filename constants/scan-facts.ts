// Something to read while a scan runs. Deliberately unrelated to the job —
// the point is to make a wait pass, not to teach anything.
//
// Both languages are carried here rather than translated at runtime: nothing
// on Android rewrites an app's strings for you, and the rest of the app
// already pairs every user-facing string with a Spanish counterpart.

export interface ScanFact {
  en: string;
  es: string;
}

export const SCAN_FACTS: ScanFact[] = [
  {
    en: 'Sharks existed before trees, appearing in the oceans roughly 400 million years ago.',
    es: 'Los tiburones existían antes que los árboles; aparecieron en los océanos hace unos 400 millones de años.',
  },
  {
    en: 'A day on Venus is longer than one Venusian year.',
    es: 'Un día en Venus dura más que un año venusiano.',
  },
  {
    en: 'Honey never spoils; archaeologists have found 3,000-year-old honey in Egyptian tombs that remains edible.',
    es: 'La miel nunca se echa a perder; se ha encontrado miel de 3,000 años en tumbas egipcias que aún es comestible.',
  },
  {
    en: 'Wombat poop is completely cube-shaped to stop it from rolling away.',
    es: 'El excremento del wómbat es completamente cúbico para que no ruede y se aleje.',
  },
  {
    en: 'Bananas are naturally radioactive because they contain high levels of potassium.',
    es: 'Los plátanos son naturalmente radiactivos porque contienen altos niveles de potasio.',
  },
  {
    en: 'Scotland’s official national animal is the magical unicorn.',
    es: 'El animal nacional oficial de Escocia es el unicornio mágico.',
  },
  {
    en: 'Cleopatra lived closer in time to the Moon landing than to the building of the Great Pyramid.',
    es: 'Cleopatra vivió más cerca en el tiempo de la llegada a la Luna que de la construcción de la Gran Pirámide.',
  },
  {
    en: 'Platypuses do not have stomachs; their food goes straight from the esophagus to the intestines.',
    es: 'Los ornitorrincos no tienen estómago; su comida pasa del esófago directo a los intestinos.',
  },
  {
    en: 'Cows have best friends and get stressed when they are separated.',
    es: 'Las vacas tienen mejores amigas y se estresan cuando las separan.',
  },
  {
    en: 'There are more trees on Earth than stars in the Milky Way galaxy.',
    es: 'Hay más árboles en la Tierra que estrellas en la galaxia Vía Láctea.',
  },
  {
    en: 'Oxford University is older than the entire Aztec Empire.',
    es: 'La Universidad de Oxford es más antigua que todo el Imperio azteca.',
  },
  {
    en: 'The Eiffel Tower grows taller in the summer heat due to thermal expansion of iron.',
    es: 'La Torre Eiffel crece con el calor del verano por la dilatación térmica del hierro.',
  },
  {
    en: 'Hot water can freeze faster than cold water under specific conditions, known as the Mpemba effect.',
    es: 'El agua caliente puede congelarse más rápido que la fría en ciertas condiciones: el efecto Mpemba.',
  },
  {
    en: 'A cloud weighs about one million tonnes on average.',
    es: 'Una nube pesa en promedio alrededor de un millón de toneladas.',
  },
  {
    en: 'Octopuses have three hearts and blue-colored blood.',
    es: 'Los pulpos tienen tres corazones y sangre de color azul.',
  },
  {
    en: 'Humans share roughly 60 percent of their DNA with bananas.',
    es: 'Los humanos comparten cerca del 60 por ciento de su ADN con los plátanos.',
  },
  {
    en: 'The tongue of a blue whale weighs as much as an entire adult elephant.',
    es: 'La lengua de una ballena azul pesa tanto como un elefante adulto entero.',
  },
  {
    en: 'Starfish do not have a brain and lack any blood.',
    es: 'Las estrellas de mar no tienen cerebro ni sangre.',
  },
  {
    en: 'A single spoonful of a neutron star would weigh about six billion tons.',
    es: 'Una sola cucharada de una estrella de neutrones pesaría unos seis mil millones de toneladas.',
  },
  {
    en: 'Sloths can hold their breath underwater longer than dolphins can.',
    es: 'Los perezosos aguantan la respiración bajo el agua más tiempo que los delfines.',
  },
  {
    en: 'Sound travels about four times faster in water than it does in air.',
    es: 'El sonido viaja unas cuatro veces más rápido en el agua que en el aire.',
  },
  {
    en: 'Shrimps keep their hearts located inside their heads.',
    es: 'Los camarones tienen el corazón dentro de la cabeza.',
  },
  {
    en: 'A snail can take a nap that lasts for up to three years.',
    es: 'Un caracol puede dormir una siesta que dura hasta tres años.',
  },
  {
    en: 'Venus spins in the opposite direction of almost every other planet in our solar system.',
    es: 'Venus gira en dirección contraria a casi todos los demás planetas del sistema solar.',
  },
  {
    en: 'Butterflies taste their food using receptors attached to their feet.',
    es: 'Las mariposas saborean su comida con receptores en las patas.',
  },
  {
    en: 'Polar bear fur is actually transparent, not white; their skin underneath is pitch black.',
    es: 'El pelaje del oso polar es transparente, no blanco; su piel debajo es negra como el carbón.',
  },
  {
    en: 'A single lightning bolt contains enough energy to toast 100,000 slices of bread.',
    es: 'Un solo rayo contiene energía suficiente para tostar 100,000 rebanadas de pan.',
  },
  {
    en: 'Koalas have fingerprints that are almost identical to human fingerprints.',
    es: 'Los koalas tienen huellas dactilares casi idénticas a las humanas.',
  },
  {
    en: 'The total weight of all ants on Earth is greater than the total weight of all humans.',
    es: 'El peso total de todas las hormigas de la Tierra supera el de todos los humanos.',
  },
  {
    en: 'An ostrich’s eyeball is bigger than its entire brain.',
    es: 'El ojo de un avestruz es más grande que todo su cerebro.',
  },
  {
    en: 'Fireflies are actually a species of beetle.',
    es: 'Las luciérnagas son en realidad una especie de escarabajo.',
  },
  {
    en: 'All the planets in our solar system could easily fit inside the space between Earth and the Moon.',
    es: 'Todos los planetas del sistema solar cabrían de sobra en el espacio entre la Tierra y la Luna.',
  },
  {
    en: 'Water can exist in three states — solid, liquid, and gas — at the exact same temperature and pressure.',
    es: 'El agua puede existir en tres estados —sólido, líquido y gas— a la misma temperatura y presión exactas.',
  },
  {
    en: 'The human stomach replaces its entire lining every few days to avoid digesting itself.',
    es: 'El estómago humano renueva todo su revestimiento cada pocos días para no digerirse a sí mismo.',
  },
  {
    en: 'A bolt of lightning is five times hotter than the surface of the Sun.',
    es: 'Un rayo es cinco veces más caliente que la superficie del Sol.',
  },
  {
    en: 'In Switzerland, it is illegal to own just one guinea pig because they get lonely.',
    es: 'En Suiza es ilegal tener un solo cuyo porque se sienten solos.',
  },
  {
    en: 'An Italian bank accepts wheels of real Parmesan cheese as collateral for loans.',
    es: 'Un banco italiano acepta ruedas de queso parmesano auténtico como garantía de préstamos.',
  },
  {
    en: 'Baboons have been documented washing their food before eating it.',
    es: 'Se ha documentado que los babuinos lavan su comida antes de comerla.',
  },
  {
    en: 'A group of flamingos is officially called a "flamboyance."',
    es: 'A un grupo de flamencos se le llama oficialmente una "flamboyance".',
  },
  {
    en: 'Polar ice reflects up to 85 percent of the sun’s rays back into space.',
    es: 'El hielo polar refleja hasta el 85 por ciento de los rayos del sol de vuelta al espacio.',
  },
  {
    en: 'Male seahorses are the ones that get pregnant and give birth to the babies.',
    es: 'Son los caballitos de mar machos los que se embarazan y dan a luz a las crías.',
  },
  {
    en: 'Cats cannot taste anything that is sweet.',
    es: 'Los gatos no pueden percibir el sabor dulce.',
  },
  {
    en: 'There is a giant cloud of raspberry-flavored alcohol floating in deep space.',
    es: 'Hay una nube gigante de alcohol con sabor a frambuesa flotando en el espacio profundo.',
  },
  {
    en: 'Your brain uses about 20 percent of the oxygen and energy your body produces.',
    es: 'Tu cerebro usa cerca del 20 por ciento del oxígeno y la energía que produce tu cuerpo.',
  },
  {
    en: 'A woodpecker can peck wood twenty times every single second.',
    es: 'Un pájaro carpintero puede picotear la madera veinte veces por segundo.',
  },
  {
    en: 'Sea otters hold hands while they sleep so they do not drift apart.',
    es: 'Las nutrias marinas se toman de las manos al dormir para no separarse a la deriva.',
  },
];
