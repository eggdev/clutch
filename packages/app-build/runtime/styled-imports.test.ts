import { expect, test } from 'bun:test';

import { splitStyledImports } from '@repo/app-build/runtime/styled-imports.ts';

test('a styled component comes from its own module, and the rest from React Native', () => {
  expect(
    splitStyledImports(
      "import { Platform, Text as NativeText, View } from 'react-native-css/components';",
    ),
  ).toBe(
    [
      "import { Text as NativeText } from 'react-native-css/components/Text';",
      "import { View } from 'react-native-css/components/View';",
      "import { Platform } from 'react-native';",
    ].join('\n'),
  );
});

test('an import of another module stays as it is', () => {
  const code = "import { cn } from '@repo/design-system/ui/cn';";
  expect(splitStyledImports(code)).toBe(code);
});
