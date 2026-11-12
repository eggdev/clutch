declare module 'virtual:native-styles' {
  import type { StyleCollection } from 'react-native-css/native-internal';

  const stylesheet: Parameters<typeof StyleCollection.inject>[0];
  export default stylesheet;
}
