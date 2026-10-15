import { normalize, Path } from '@angular-devkit/core';
import {
  createSourceFile,
  ImportDeclaration,
  isIdentifier,
  isImportDeclaration,
  isImportEqualsDeclaration,
  isStringLiteral,
  isClassDeclaration,
  isClassStaticBlockDeclaration,
  isEnumDeclaration,
  isFunctionDeclaration,
  isFunctionLike,
  isInterfaceDeclaration,
  isModuleDeclaration,
  isTypeAliasDeclaration,
  isVariableDeclarationList,
  isVariableStatement,
  Node,
  NodeFlags,
  ScriptTarget,
  SourceFile,
  SyntaxKind,
} from 'typescript';
import { DeclarationOptions } from './module.declarator.js';
import { PathSolver } from './path.solver.js';

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

  /**
   * Declares the import and returns the local name used by module metadata.
   */
  public declareWithSymbol(
    content: string,
    options: DeclarationOptions,
  ): { content: string; symbol: string } {
    const symbol = String(options.symbol);
    const source = createSourceFile(
      options.module,
      content,
      ScriptTarget.Latest,
    );
    const imports = source.statements.filter(isImportDeclaration);
    const targetPath = this.computeRelativePath(options);
    const requestedImports = this.findRequestedImports(
      imports,
      symbol,
      targetPath,
    );
    if (requestedImports.length > 0) {
      return { content, symbol: requestedImports[0].localName };
    }

    const bindings = this.getModuleBindings(source);
    const localSymbol = this.uniqueSymbol(symbol, bindings);
    const toInsert = this.buildLineToInsert(options, localSymbol);
    const contentLines = content.split('\n');
    const finalImportIndex = this.findImportsEndpoint(contentLines);
    contentLines.splice(finalImportIndex + 1, 0, toInsert);
    return { content: contentLines.join('\n'), symbol: localSymbol };
  }

  private findRequestedImports(
    imports: ImportDeclaration[],
    symbol: string,
    targetPath: string,
  ): Array<{ localName: string }> {
    const bindings: Array<{ localName: string }> = [];
    for (const declaration of imports) {
      const clause = declaration.importClause;
      if (
        !clause ||
        clause.isTypeOnly ||
        !isStringLiteral(declaration.moduleSpecifier) ||
        declaration.moduleSpecifier.text !== targetPath ||
        clause.namedBindings?.kind !== SyntaxKind.NamedImports
      ) {
        continue;
      }
      for (const specifier of clause.namedBindings.elements) {
        const importedName = specifier.propertyName ?? specifier.name;
        if (
          !specifier.isTypeOnly &&
          isIdentifier(importedName) &&
          importedName.text === symbol
        ) {
          bindings.push({ localName: specifier.name.text });
        }
      }
    }
    return bindings;
  }

  private getModuleBindings(source: SourceFile): Set<string> {
    const bindings = new Set<string>();
    for (const statement of source.statements) {
      if (isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (!clause) continue;
        if (clause.name) bindings.add(clause.name.text);
        if (clause.namedBindings?.kind === SyntaxKind.NamespaceImport) {
          bindings.add(clause.namedBindings.name.text);
        } else if (clause.namedBindings) {
          for (const specifier of clause.namedBindings.elements) {
            bindings.add(specifier.name.text);
          }
        }
        continue;
      }
      if (isImportEqualsDeclaration(statement)) {
        bindings.add(statement.name.text);
      }
      if (
        (isClassDeclaration(statement) ||
          isFunctionDeclaration(statement) ||
          isInterfaceDeclaration(statement) ||
          isTypeAliasDeclaration(statement) ||
          isEnumDeclaration(statement) ||
          isModuleDeclaration(statement)) &&
        statement.name &&
        isIdentifier(statement.name)
      ) {
        bindings.add(statement.name.text);
      }
      if (isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          this.addBindingNames(declaration.name, bindings);
        }
      }
    }
    this.addTopLevelVarBindings(source, bindings);
    return bindings;
  }

  private addTopLevelVarBindings(
    source: SourceFile,
    bindings: Set<string>,
  ): void {
    const visit = (node: Node): void => {
      if (
        node !== source &&
        (isFunctionLike(node) ||
          isClassStaticBlockDeclaration(node) ||
          isModuleDeclaration(node))
      ) {
        return;
      }
      if (
        isVariableDeclarationList(node) &&
        (node.flags & NodeFlags.BlockScoped) === 0
      ) {
        for (const declaration of node.declarations) {
          this.addBindingNames(declaration.name, bindings);
        }
      }
      node.forEachChild(visit);
    };
    visit(source);
  }

  private addBindingNames(
    name: import('typescript').BindingName,
    bindings: Set<string>,
  ): void {
    if (isIdentifier(name)) {
      bindings.add(name.text);
      return;
    }
    for (const element of name.elements) {
      if (element.kind !== SyntaxKind.OmittedExpression) {
        this.addBindingNames(element.name, bindings);
      }
    }
  }

  private uniqueSymbol(symbol: string, bindings: Set<string>): string {
    if (!bindings.has(symbol)) return symbol;
    let suffix = 1;
    while (bindings.has(`${symbol}_${suffix}`)) suffix++;
    return `${symbol}_${suffix}`;
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
    const alias = localSymbol === options.symbol ? '' : ` as ${localSymbol}`;
    return `import { ${options.symbol}${alias} } from '${this.computeRelativePath(options)}';`;
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
