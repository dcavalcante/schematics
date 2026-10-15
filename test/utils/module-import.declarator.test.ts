import { normalize } from '@angular-devkit/core';
import { Tree } from '@angular-devkit/schematics';
import { ModuleImportDeclarator } from '../../src/utils/module-import.declarator.js';
import {
  DeclarationOptions,
  ModuleDeclarator,
} from '../../src/utils/module.declarator.js';
import ts from 'typescript';
import vm from 'node:vm';

describe('Module Import Declarator', () => {
  it('should add import to the buffered module content', () => {
    const content: string =
      "import { Module } from '@nestjs/common';\n" +
      '\n' +
      '@Module({})\n' +
      'export class FooModule {}\n';
    const options: DeclarationOptions = {
      metadata: 'imports',
      type: 'module',
      name: 'bar',
      path: normalize('/src/foo/bar'),
      module: normalize('/src/foo/foo.module.ts'),
      symbol: 'BarModule',
    };
    const declarator = new ModuleImportDeclarator();
    expect(declarator.declare(content, options)).toEqual(
      "import { Module } from '@nestjs/common';\n" +
        "import { BarModule } from './bar/bar.module';\n" +
        '\n' +
        '@Module({})\n' +
        'export class FooModule {}\n',
    );
  });

  it('should manage no type', () => {
    const content: string =
      "import { Module } from '@nestjs/common';\n" +
      '\n' +
      '@Module({})\n' +
      'export class FooModule {}\n';
    const options: DeclarationOptions = {
      metadata: 'providers',
      name: 'foo',
      path: normalize('/src/foo'),
      module: normalize('/src/foo/foo.ts'),
      symbol: 'Foo',
    };
    const declarator = new ModuleImportDeclarator();
    expect(declarator.declare(content, options)).toEqual(
      "import { Module } from '@nestjs/common';\n" +
        "import { Foo } from './foo';\n" +
        '\n' +
        '@Module({})\n' +
        'export class FooModule {}\n',
    );
  });

  it('should not break existing multi-line imports', () => {
    const content: string =
      'import {\n' +
      '  Module,\n' +
      '  Helper,\n' +
      "} from '@nestjs/common';\n" +
      '\n' +
      '@Helper()\n' +
      '@Module({})\n' +
      'export class FooModule {}\n';

    const options: DeclarationOptions = {
      metadata: 'imports',
      type: 'module',
      name: 'bar',
      path: normalize('/src/foo/bar'),
      module: normalize('/src/foo/foo.module.ts'),
      symbol: 'BarModule',
    };
    const declarator = new ModuleImportDeclarator();
    expect(declarator.declare(content, options)).toEqual(
      'import {\n' +
        '  Module,\n' +
        '  Helper,\n' +
        "} from '@nestjs/common';\n" +
        "import { BarModule } from './bar/bar.module';\n" +
        '\n' +
        '@Helper()\n' +
        '@Module({})\n' +
        'export class FooModule {}\n',
    );
  });

  it('should append .js extension for providers when isEsm is true', () => {
    const content: string =
      "import { Module } from '@nestjs/common';\n" +
      '\n' +
      '@Module({})\n' +
      'export class FooModule {}\n';
    const options: DeclarationOptions = {
      metadata: 'providers',
      name: 'foo',
      path: normalize('/src/foo'),
      module: normalize('/src/foo/foo.ts'),
      symbol: 'Foo',
      isEsm: true,
    };
    const declarator = new ModuleImportDeclarator();
    expect(declarator.declare(content, options)).toEqual(
      "import { Module } from '@nestjs/common';\n" +
        "import { Foo } from './foo.js';\n" +
        '\n' +
        '@Module({})\n' +
        'export class FooModule {}\n',
    );
  });

  it('should append .js extension for module imports when isEsm is true', () => {
    const content: string =
      "import { Module } from '@nestjs/common';\n" +
      '\n' +
      '@Module({})\n' +
      'export class FooModule {}\n';
    const options: DeclarationOptions = {
      metadata: 'imports',
      type: 'module',
      name: 'bar',
      path: normalize('/src/foo/bar'),
      module: normalize('/src/foo/foo.module.ts'),
      symbol: 'BarModule',
      isEsm: true,
    };
    const declarator = new ModuleImportDeclarator();
    expect(declarator.declare(content, options)).toEqual(
      "import { Module } from '@nestjs/common';\n" +
        "import { BarModule } from './bar/bar.module.js';\n" +
        '\n' +
        '@Module({})\n' +
        'export class FooModule {}\n',
    );
  });

  it('should not break on match of "from" in another context', () => {
    const content: string =
      'import {\n' +
      '  Module,\n' +
      '  Helper,\n' +
      "} from '@nestjs/common';\n" +
      '\n' +
      '@Helper()\n' +
      '@Module({})\n' +
      'const x = " from ";\n' +
      'console.error(" from ");\n' +
      'export class FooModule {}\n';

    const options: DeclarationOptions = {
      metadata: 'imports',
      type: 'module',
      name: 'bar',
      path: normalize('/src/foo/bar'),
      module: normalize('/src/foo/foo.module.ts'),
      symbol: 'BarModule',
    };
    const declarator = new ModuleImportDeclarator();
    expect(declarator.declare(content, options)).toEqual(
      'import {\n' +
        '  Module,\n' +
        '  Helper,\n' +
        "} from '@nestjs/common';\n" +
        "import { BarModule } from './bar/bar.module';\n" +
        '\n' +
        '@Helper()\n' +
        '@Module({})\n' +
        'const x = " from ";\n' +
        'console.error(" from ");\n' +
        'export class FooModule {}\n',
    );
  });

  it('should alias the generated import when the same name comes from another module', () => {
    const content =
      "import { UsersService } from './legacy/users.service';\n" +
      '@Module({})\n' +
      'export class AppModule {}\n';
    const options: DeclarationOptions = {
      metadata: 'providers',
      name: 'users',
      type: 'service',
      path: normalize('/src/users'),
      module: normalize('/src/app.module.ts'),
      symbol: 'UsersService',
    };

    const generated = new ModuleDeclarator().declare(content, options);
    expect(generated).toContain(
      "import { UsersService as UsersService_1 } from './users/users.service';",
    );
    expect(generated).toContain('providers: [UsersService_1]');
    expect(generated).toContain(
      "import { UsersService } from './legacy/users.service';",
    );
    expect(new ModuleDeclarator().declare(generated, options)).toBe(generated);
  });

  it('should register the generated class when another module exports the same name', () => {
    const content =
      "import { UsersService } from './legacy/users.service';\n" +
      "import { Module } from '@nestjs/common';\n" +
      '@Module({ providers: [] })\n' +
      'export class AppModule {}\n';
    const options: DeclarationOptions = {
      metadata: 'providers',
      name: 'users',
      type: 'service',
      path: normalize('/src/users'),
      module: normalize('/src/app.module.ts'),
      symbol: 'UsersService',
    };
    const generated = new ModuleDeclarator().declare(content, options);
    let capturedMetadata: { providers: unknown[] } | undefined;
    class LegacyUsersService {}
    class GeneratedUsersService {}
    const javascript = ts.transpile(generated, {
      experimentalDecorators: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    });
    const context = {
      exports: {},
      require: (specifier: string) => {
        if (specifier === '@nestjs/common') {
          return {
            Module: (metadata: { providers: unknown[] }) => () => {
              capturedMetadata = metadata;
            },
          };
        }
        if (specifier === './legacy/users.service') {
          return { UsersService: LegacyUsersService };
        }
        if (specifier === './users/users.service') {
          return { UsersService: GeneratedUsersService };
        }
        throw new Error(`Unexpected import: ${specifier}`);
      },
    };

    vm.runInNewContext(javascript, context);

    expect(capturedMetadata?.providers[0]).toBe(GeneratedUsersService);
    expect(capturedMetadata?.providers[0]).not.toBe(LegacyUsersService);
  });

  it('should reuse a barrel import when it resolves to the generated class', () => {
    const content =
      "import { UsersService } from './users';\n" +
      "import { Module } from '@nestjs/common';\n" +
      '@Module({ providers: [] })\n' +
      'export class AppModule {}\n';
    const tree = Tree.empty();
    tree.create('/src/app.module.ts', content);
    tree.create(
      '/src/users/index.ts',
      "export { UsersService } from './users.service';\n",
    );
    tree.create(
      '/src/users/users.service.ts',
      'export class UsersService {}\n',
    );
    const options: DeclarationOptions = {
      metadata: 'providers',
      name: 'users',
      type: 'service',
      path: normalize('/src/users'),
      module: normalize('/src/app.module.ts'),
      symbol: 'UsersService',
      tree,
    };

    const generated = new ModuleDeclarator().declare(content, options);
    expect(generated).toBe(
      content.replace('providers: []', 'providers: [UsersService]'),
    );
  });

  it('should not reuse a barrel import when it resolves to a different class', () => {
    const content =
      "import { UsersService } from './legacy';\n" +
      "import { Module } from '@nestjs/common';\n" +
      '@Module({ providers: [] })\n' +
      'export class AppModule {}\n';
    const tree = Tree.empty();
    tree.create('/src/app.module.ts', content);
    tree.create(
      '/src/legacy/index.ts',
      "export { UsersService } from './users.service';\n",
    );
    tree.create(
      '/src/legacy/users.service.ts',
      'export class UsersService {}\n',
    );
    tree.create(
      '/src/users/users.service.ts',
      'export class UsersService {}\n',
    );
    const options: DeclarationOptions = {
      metadata: 'providers',
      name: 'users',
      type: 'service',
      path: normalize('/src/users'),
      module: normalize('/src/app.module.ts'),
      symbol: 'UsersService',
      tree,
    };

    const generated = new ModuleDeclarator().declare(content, options);
    expect(generated).toContain('providers: [UsersService_1]');
    expect(generated).toContain("from './users/users.service'");
  });

  it('should resolve barrel identity through tsconfig path aliases', () => {
    const content =
      "import { UsersService } from '@users';\n" +
      "import { Module } from '@nestjs/common';\n" +
      '@Module({ providers: [] })\n' +
      'export class AppModule {}\n';
    const tree = Tree.empty();
    tree.create(
      '/tsconfig.json',
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '@users': ['src/users/index.ts'] },
        },
      }),
    );
    tree.create('/src/app.module.ts', content);
    tree.create(
      '/src/users/index.ts',
      "export { UsersService } from './users.service';\n",
    );
    tree.create(
      '/src/users/users.service.ts',
      'export class UsersService {}\n',
    );
    const options: DeclarationOptions = {
      metadata: 'providers',
      name: 'users',
      type: 'service',
      path: normalize('/src/users'),
      module: normalize('/src/app.module.ts'),
      symbol: 'UsersService',
      tree,
    };

    const generated = new ModuleDeclarator().declare(content, options);
    expect(generated).toBe(
      content.replace('providers: []', 'providers: [UsersService]'),
    );
  });

  it('should alias the generated import when a local class occupies its name', () => {
    const content =
      'class UsersService {}\n' +
      "import { Module } from '@nestjs/common';\n" +
      '@Module({ providers: [] })\n' +
      'export class AppModule {}\n';
    const options: DeclarationOptions = {
      metadata: 'providers',
      name: 'users',
      type: 'service',
      path: normalize('/src/users'),
      module: normalize('/src/app.module.ts'),
      symbol: 'UsersService',
    };

    const generated = new ModuleDeclarator().declare(content, options);
    expect(generated).toContain(
      "import { UsersService as UsersService_1 } from './users/users.service';",
    );
    expect(generated).toContain('providers: [UsersService_1]');
  });

  it('should not reuse a same-name named import from another module', () => {
    const content =
      "import UsersService, { OtherService } from './services';\n" +
      '@Module({})\n' +
      'export class AppModule {}\n';
    const options: DeclarationOptions = {
      metadata: 'providers',
      name: 'users',
      type: 'service',
      path: normalize('/src/users'),
      module: normalize('/src/app.module.ts'),
      symbol: 'OtherService',
    };

    expect(new ModuleImportDeclarator().declare(content, options)).toContain(
      "import { OtherService as OtherService_1 } from './users/users.service';",
    );
  });

  it('should not treat an import alias as the requested exported symbol', () => {
    const content =
      "import { UsersService as LegacyUsers } from './legacy/users.service';\n" +
      '@Module({})\n' +
      'export class AppModule {}\n';
    const options: DeclarationOptions = {
      metadata: 'providers',
      name: 'users',
      type: 'service',
      path: normalize('/src/users'),
      module: normalize('/src/app.module.ts'),
      symbol: 'UsersService',
    };

    expect(new ModuleImportDeclarator().declare(content, options)).toContain(
      "import { UsersService } from './users/users.service';",
    );
  });

  it('should alias the generated import when a different import occupies its local name', () => {
    const content =
      "import { Other as UsersService } from './other.service';\n" +
      "import { Module } from '@nestjs/common';\n" +
      '@Module({ providers: [] })\n' +
      'export class AppModule {}\n';
    const options: DeclarationOptions = {
      metadata: 'providers',
      name: 'users',
      type: 'service',
      path: normalize('/src/users'),
      module: normalize('/src/app.module.ts'),
      symbol: 'UsersService',
    };

    const generated = new ModuleDeclarator().declare(content, options);
    expect(generated).toContain(
      "import { UsersService as UsersService_1 } from './users/users.service';",
    );
    expect(generated).toContain('providers: [UsersService_1]');
    expect(new ModuleDeclarator().declare(generated, options)).toBe(generated);
  });

  it.each([
    "import type { UsersService } from './users.interface';\n",
    "import { type UsersService } from './users.interface';\n",
  ])(
    'should alias a generated value import when a type-only import occupies its name',
    (typeImport) => {
      const content =
        typeImport +
        "import { Module } from '@nestjs/common';\n" +
        '@Module({ providers: [] })\n' +
        'export class AppModule {}\n';
      const options: DeclarationOptions = {
        metadata: 'providers',
        name: 'users',
        type: 'service',
        path: normalize('/src/users'),
        module: normalize('/src/app.module.ts'),
        symbol: 'UsersService',
      };

      const generated = new ModuleDeclarator().declare(content, options);
      expect(generated).toContain(
        "import { UsersService as UsersService_1 } from './users/users.service';",
      );
      expect(generated).toContain('providers: [UsersService_1]');
      expect(new ModuleDeclarator().declare(generated, options)).toBe(
        generated,
      );
    },
  );

  it('should reuse an aliased import from the generated module on a second pass', () => {
    const content =
      "import { UsersService as GeneratedUsersService } from './users/../users/users.service.js';\n" +
      "import { Module } from '@nestjs/common';\n" +
      '@Module({ providers: [] })\n' +
      'export class AppModule {}\n';
    const options: DeclarationOptions = {
      metadata: 'providers',
      name: 'users',
      type: 'service',
      path: normalize('/src/users'),
      module: normalize('/src/app.module.ts'),
      symbol: 'UsersService',
      isEsm: true,
    };

    const generated = new ModuleDeclarator().declare(content, options);
    expect(generated).toBe(
      content.replace('providers: []', 'providers: [GeneratedUsersService]'),
    );
    expect(new ModuleDeclarator().declare(generated, options)).toBe(generated);
  });

  it.each([
    [
      'an aliased value import',
      "import { Other as UsersService } from './other.service';\n",
      'export class Other {}',
    ],
    [
      'a type-only import clause',
      "import type { UsersService } from './other.service';\n",
      'export interface UsersService {}',
    ],
    [
      'a type-only named import',
      "import { type UsersService } from './other.service';\n",
      'export interface UsersService {}',
    ],
    ['a local class declaration', 'class UsersService {}\n', ''],
  ])(
    'should generate compilable code for %s',
    (_case, conflictingImport, conflictingModule) => {
      const content =
        conflictingImport +
        "import { Module } from '@nestjs/common';\n" +
        '@Module({ providers: [] })\n' +
        'export class AppModule {}\n';
      const options: DeclarationOptions = {
        metadata: 'providers',
        name: 'users',
        type: 'service',
        path: normalize('/src/users'),
        module: normalize('/src/app.module.ts'),
        symbol: 'UsersService',
      };
      const generated = new ModuleDeclarator().declare(content, options);
      const files = new Map([
        ['/project/src/app.module.ts', generated],
        ['/project/src/other.service.ts', conflictingModule],
        ['/project/src/users/users.service.ts', 'export class UsersService {}'],
        [
          '/project/node_modules/@nestjs/common/index.d.ts',
          'export declare function Module(options: { providers?: unknown[] }): ClassDecorator;',
        ],
      ]);
      const compilerOptions: ts.CompilerOptions = {
        experimentalDecorators: true,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        noEmit: true,
        skipLibCheck: true,
        strict: true,
        target: ts.ScriptTarget.ES2022,
      };
      const host = ts.createCompilerHost(compilerOptions);
      const originalFileExists = host.fileExists.bind(host);
      const originalDirectoryExists = host.directoryExists?.bind(host);
      const originalReadFile = host.readFile.bind(host);
      const originalGetSourceFile = host.getSourceFile?.bind(host);
      host.fileExists = (fileName) =>
        files.has(fileName) || originalFileExists(fileName);
      host.directoryExists = (directoryName) =>
        [...files.keys()].some((fileName) =>
          fileName.startsWith(`${directoryName}/`),
        ) || originalDirectoryExists?.(directoryName) === true;
      host.readFile = (fileName) =>
        files.get(fileName) ?? originalReadFile(fileName);
      host.getSourceFile = (fileName, languageVersion, ...rest) => {
        const file = files.get(fileName);
        return file === undefined
          ? originalGetSourceFile?.(fileName, languageVersion, ...rest)
          : ts.createSourceFile(fileName, file, languageVersion, true);
      };
      const program = ts.createProgram(
        ['/project/src/app.module.ts'],
        compilerOptions,
        host,
      );

      expect(ts.getPreEmitDiagnostics(program)).toEqual([]);
    },
  );

  it('should ignore import-like text inside comments', () => {
    const content =
      "/* import { UsersService } from './users.service'; */\n" +
      '@Module({})\n' +
      'export class AppModule {}\n';
    const options: DeclarationOptions = {
      metadata: 'providers',
      name: 'users',
      type: 'service',
      path: normalize('/src/users'),
      module: normalize('/src/app.module.ts'),
      symbol: 'UsersService',
    };

    expect(new ModuleImportDeclarator().declare(content, options)).toContain(
      "import { UsersService } from './users/users.service';",
    );
  });
});
