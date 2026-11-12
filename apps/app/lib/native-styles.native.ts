import { StyleCollection } from 'react-native-css/native-internal';
import compiled from 'virtual:native-styles';

/**
 * Registers the classes of Tailwind as react-native-css styles, from the
 * native styles plugin in vite.config.ts. Call it once, before the first render.
 */
export function registerNativeStyles(): void {
  StyleCollection.inject(compiled);
}
