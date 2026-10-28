import { transformAsync } from '@babel/core';
import reactCompiler from 'babel-plugin-react-compiler';
import { plugin } from 'bun';

/**
 * Test preload, wired in bunfig.toml. It runs React Compiler on each `.tsx`
 * file of the workspace, as the web build does, so a test that counts renders
 * sees what users see. Babel keeps the TypeScript, and Bun strips it.
 */
await plugin({
  name: 'react-compiler',
  setup(build) {
    build.onLoad(
      { filter: /\/(?:apps|features|packages)\/(?!.*node_modules).*\.tsx$/u },
      async (args) => {
        const source = await Bun.file(args.path).text();
        const result = await transformAsync(source, {
          filename: args.path,
          babelrc: false,
          configFile: false,
          parserOpts: { plugins: ['jsx', 'typescript'] },
          plugins: [reactCompiler],
        });
        return { contents: result?.code ?? source, loader: 'tsx' };
      },
    );
  },
});
