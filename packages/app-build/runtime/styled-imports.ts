/**
 * The React Native components that react-native-css wraps for `className`. Each
 * has its own module under `react-native-css/components/`.
 */
const styledComponents = new Set([
  'ActivityIndicator',
  'Button',
  'FlatList',
  'Image',
  'ImageBackground',
  'KeyboardAvoidingView',
  'Pressable',
  'ScrollView',
  'Switch',
  'Text',
  'TextInput',
  'TouchableHighlight',
  'TouchableOpacity',
  'TouchableWithoutFeedback',
  'View',
  'VirtualizedList',
]);

/**
 * The module of each styled component. The dev server bundles them at its
 * start. Without that, it finds each one at the first page that uses it, then
 * bundles again and reloads the page under the person or the test that opened it.
 */
export const styledComponentModules: ReadonlyArray<string> = [...styledComponents].map(
  (name) => `react-native-css/components/${name}`,
);

const namedStyledImport =
  /\bimport\s*\{([^}]*)\}\s*from\s*(['"])react-native-css\/components\2;?/gu;

/**
 * The web build takes each styled component from its own module, and the rest
 * from React Native. The barrel `react-native-css/components` is CommonJS, so
 * an import of it would put every React Native for Web component in the first
 * screen.
 */
export function splitStyledImports(code: string): string {
  return code.replaceAll(namedStyledImport, (_match, names: string) => {
    const lines: Array<string> = [];
    const plain: Array<string> = [];
    for (const entry of names.split(',')) {
      const name = entry.trim();
      if (name === '') {
        continue;
      }
      const imported = name.split(/\s+as\s+/u)[0] ?? name;
      if (styledComponents.has(imported)) {
        lines.push(`import { ${name} } from 'react-native-css/components/${imported}';`);
      } else {
        plain.push(name);
      }
    }
    if (plain.length > 0) {
      lines.push(`import { ${plain.join(', ')} } from 'react-native';`);
    }
    return lines.join('\n');
  });
}
