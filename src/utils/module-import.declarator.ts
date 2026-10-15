import { normalize, Path } from '@angular-devkit/core';
import {
  createSourceFile,
  isIdentifier,
  isImportDeclaration,
  isImportEqualsDeclaration,
  isStringLiteral,
  SyntaxKind,
} from 'typescript';
import type {
  ImportDeclaration,
  NamedImports,
  Node,
  ScriptTarget,
  SourceFile,
} from 'typescript';
import { DeclarationOptions } from './module.declarator.js';
import { importResolvesToGeneratedExport } from './module-export.resolver.js';
import { PathSolver } from './path.solver.js';

interface ImportResult {
  content: string;
  symbol: string;
}

interface ImportBinding {
  matchesImportedSymbol: boolean;
  symbol: string;
}

/**
 * The `ModuleImportDeclarator` class is responsible for declaring module imports
 * in a TypeScript file. It provides methods to insert import statements into the
 * file content based on the provided declaration options.
 */
export class ModuleImportDeclarator {
  constructor(private solver: PathSolver = new PathSolver()) {}

  /**
   * Declares a module import in the given content string.
   *
   * @param content - The content of the file where the import will be declared.
   * @param options - The options for the declaration, including the symbol and path.
   * @returns The updated content string with the import statement inserted.
   */
  public declare(content: string, options: DeclarationOptions): string {
    return this.declareWithSymbol(content, options).content;
  }

  public declareWithSymbol(
    content: string,
    options: DeclarationOptions,
  ): ImportResult {
    const source = createSourceFile(
      'filename.ts',
      content,
      99 as ScriptTarget,
      true,
    );
    const requestedSymbol = options.symbol!;
    const binding = this.findImportBinding(source, options);

    if (binding?.matchesImportedSymbol) {
      return { content, symbol: binding.symbol };
    }

    const localSymbol = binding
      ? this.createUniqueLocalSymbol(source, requestedSymbol)
      : requestedSymbol;
    const toInsert = this.buildLineToInsert(options, localSymbol);
    const contentLines = content.split('\n');
    const finalImportIndex = this.findImportsEndpoint(contentLines);
    contentLines.splice(finalImportIndex + 1, 0, toInsert);
    return { content: contentLines.join('\n'), symbol: localSymbol };
  }

  /**
   * Finds the endpoint of the existing import statements in the content.
   *
   * @param contentLines - The lines of the content.
   * @returns The index of the last import statement.
   */
  private findImportsEndpoint(contentLines: string[]): number {
    const reversedContent = Array.from(contentLines).reverse();
    const reverseImports = reversedContent.filter((line) =>
      line.match(/\} from ('|")/),
    );
    if (reverseImports.length <= 0) {
      return 0;
    }
    return contentLines.indexOf(reverseImports[0]);
  }

  /**
   * Builds the import line to insert based on the declaration options.
   *
   * @param options - The options for the declaration, including the symbol and path.
   * @returns The import line to insert.
   */
  private buildLineToInsert(
    options: DeclarationOptions,
    localSymbol: string,
  ): string {
    const importedSymbol = options.symbol!;
    const binding =
      importedSymbol === localSymbol
        ? importedSymbol
        : `${importedSymbol} as ${localSymbol}`;
    return `import { ${binding} } from '${this.computeRelativePath(options)}';`;
  }

  private findImportBinding(
    source: SourceFile,
    options: DeclarationOptions,
  ): ImportBinding | undefined {
    const symbol = options.symbol!;
    const targetPath = this.computeRelativePath(options);
    let localNameIsOccupied = false;
    for (const statement of source.statements) {
      if (isImportDeclaration(statement)) {
        const binding = this.findDeclarationBinding(
          statement,
          symbol,
          targetPath,
          source,
          options,
        );
        if (binding?.matchesImportedSymbol) return binding;
        if (binding) {
          localNameIsOccupied ||= binding.symbol === symbol;
        }
      } else if (this.getTopLevelBindingNames(statement).has(symbol)) {
        localNameIsOccupied = true;
      }
    }
    return localNameIsOccupied
      ? { matchesImportedSymbol: false, symbol }
      : undefined;
  }

  private findDeclarationBinding(
    declaration: ImportDeclaration,
    symbol: string,
    targetPath: string,
    source: SourceFile,
    options: DeclarationOptions,
  ): ImportBinding | undefined {
    const clause = declaration.importClause;
    if (!clause) return;

    if (clause.name?.text === symbol) {
      return { matchesImportedSymbol: false, symbol };
    }

    if (!clause.namedBindings) return;
    if (clause.namedBindings.kind === SyntaxKind.NamespaceImport) {
      return clause.namedBindings.name.text === symbol
        ? { matchesImportedSymbol: false, symbol }
        : undefined;
    }

    const namedImports = clause.namedBindings as NamedImports;
    let localNameIsOccupied = false;
    for (const specifier of namedImports.elements) {
      const propertyName = specifier.propertyName;
      const importedName =
        propertyName &&
        (isIdentifier(propertyName) || isStringLiteral(propertyName))
          ? propertyName.text
          : specifier.name.text;
      const isTypeOnly = clause.isTypeOnly || specifier.isTypeOnly;
      if (importedName === symbol && !isTypeOnly) {
        const moduleSpecifier = declaration.moduleSpecifier;
        const isTargetImport =
          isStringLiteral(moduleSpecifier) &&
          this.sameModulePath(moduleSpecifier.text, targetPath);
        const resolvesToTarget =
          !isTargetImport &&
          options.tree &&
          isStringLiteral(moduleSpecifier) &&
          importResolvesToGeneratedExport(
            options.tree,
            options.module,
            source.text,
            normalize(
              `/${options.path}/${options.name}${options.type ? `.${options.type}` : ''}`,
            ),
            symbol,
            moduleSpecifier.text,
            importedName,
            options.language ?? 'ts',
          );
        if (isTargetImport || resolvesToTarget) {
          return { matchesImportedSymbol: true, symbol: specifier.name.text };
        }
      }
      if (specifier.name.text === symbol) {
        localNameIsOccupied = true;
      }
    }
    return localNameIsOccupied
      ? { matchesImportedSymbol: false, symbol }
      : undefined;
  }

  private sameModulePath(first: string, second: string): boolean {
    const normalizedFirst = normalize(first).replace(/\.js$/, '');
    const normalizedSecond = normalize(second).replace(/\.js$/, '');
    return normalizedFirst === normalizedSecond;
  }

  private getTopLevelBindingNames(statement: Node): Set<string> {
    const names = new Set<string>();
    const addBindingName = (name: Node): void => {
      if (isIdentifier(name)) {
        names.add(name.text);
      } else if (
        name.kind === SyntaxKind.ObjectBindingPattern ||
        name.kind === SyntaxKind.ArrayBindingPattern
      ) {
        for (const element of (name as import('typescript').BindingPattern)
          .elements) {
          if (element.kind !== SyntaxKind.OmittedExpression) {
            addBindingName(element.name);
          }
        }
      }
    };

    if (isImportEqualsDeclaration(statement)) {
      names.add(statement.name.text);
    } else if (statement.kind === SyntaxKind.VariableStatement) {
      for (const declaration of (
        statement as import('typescript').VariableStatement
      ).declarationList.declarations) {
        addBindingName(declaration.name);
      }
    } else {
      const declaration = statement as Node & { name?: Node };
      if (declaration.name && isIdentifier(declaration.name)) {
        names.add(declaration.name.text);
      }
    }

    return names;
  }

  private createUniqueLocalSymbol(source: SourceFile, symbol: string): string {
    const identifiers = new Set<string>();
    const visit = (node: Node): void => {
      if (isIdentifier(node)) identifiers.add(node.text);
      node.forEachChild(visit);
    };
    source.statements.forEach(visit);

    let suffix = 1;
    let candidate = `${symbol}_${suffix}`;
    while (identifiers.has(candidate)) {
      candidate = `${symbol}_${++suffix}`;
    }
    return candidate;
  }

  /**
   * Computes the relative path for the import statement.
   *
   * @param options - The options for the declaration, including the symbol and path.
   * @returns The relative path for the import statement.
   */
  private computeRelativePath(options: DeclarationOptions): string {
    let importModulePath: Path;
    if (options.type !== undefined) {
      importModulePath = normalize(
        `/${options.path}/${options.name}.${options.type}`,
      );
    } else {
      importModulePath = normalize(`/${options.path}/${options.name}`);
    }
    const relativePath = this.solver.relative(options.module, importModulePath);
    return options.isEsm ? `${relativePath}.js` : relativePath;
  }
}
