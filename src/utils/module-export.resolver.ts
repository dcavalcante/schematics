import { dirname, normalize } from '@angular-devkit/core';
import type { Path } from '@angular-devkit/core';
import type { Tree } from '@angular-devkit/schematics';
import ts from 'typescript';

const PROJECT_ROOT = '/__schematics_project__';

/** Returns whether an import resolves to the generated module's exported class. */
export function importResolvesToGeneratedExport(
  tree: Tree,
  sourcePath: Path,
  sourceContent: string,
  generatedPath: Path,
  generatedSymbol: string,
  importedPath: string,
  importedName: string,
  language: string,
): boolean {
  const sourceFilePath = toProjectPath(sourcePath);
  const targetExtension = language === 'js' ? '.js' : '.ts';
  const targetFilePath = toProjectPath(
    normalize(`${generatedPath}${targetExtension}` as Path),
  );
  const files = new Map<string, string>();
  tree.visit((path) => {
    const content = tree.read(path);
    if (content) files.set(toProjectPath(path as Path), content.toString());
  });
  files.set(sourceFilePath, sourceContent);
  files.set(targetFilePath, `export class ${generatedSymbol} {}`);

  const defaults: ts.CompilerOptions = {
    allowJs: true,
    experimentalDecorators: true,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
  };
  let options = defaults;
  let configDirectory = dirname(sourceFilePath as Path);
  while (configDirectory.startsWith(PROJECT_ROOT)) {
    const configPath = `${configDirectory}/tsconfig.json`;
    if (files.has(configPath)) {
      const configText = files.get(configPath)!;
      const parsedJson = ts.parseConfigFileTextToJson(configPath, configText);
      if (!parsedJson.error) {
        const parsed = ts.parseJsonConfigFileContent(
          parsedJson.config,
          {
            useCaseSensitiveFileNames: true,
            fileExists: (path) => files.has(normalize(path as Path)),
            readFile: (path) => files.get(normalize(path as Path)),
            readDirectory: (path) =>
              [...files.keys()].filter((fileName) =>
                fileName.startsWith(`${normalize(path as Path)}/`),
              ),
          },
          configDirectory,
          defaults,
          configPath,
        );
        options = {
          ...parsed.options,
          ...defaults,
          baseUrl: parsed.options.baseUrl,
          paths: parsed.options.paths,
        };
      }
      break;
    }
    if (configDirectory === PROJECT_ROOT) break;
    configDirectory = dirname(configDirectory as Path);
  }

  const host = ts.createCompilerHost(options);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getCurrentDirectory = () => PROJECT_ROOT;
  host.fileExists = (fileName) =>
    files.has(normalize(fileName as Path)) || fileExists(fileName);
  host.readFile = (fileName) =>
    files.get(normalize(fileName as Path)) ?? readFile(fileName);
  host.getSourceFile = (fileName, version, ...rest) => {
    const normalized = normalize(fileName as Path);
    const text = files.get(normalized);
    return text === undefined
      ? getSourceFile(fileName, version, ...rest)
      : ts.createSourceFile(fileName, text, version, true);
  };
  host.directoryExists = (directoryName) =>
    [...files.keys()].some((fileName) =>
      fileName.startsWith(`${normalize(directoryName as Path)}/`),
    );

  const program = ts.createProgram(
    [sourceFilePath, targetFilePath],
    options,
    host,
  );
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(sourceFilePath);
  const target = program.getSourceFile(targetFilePath);
  if (!source || !target) return false;

  const targetModule = checker.getSymbolAtLocation(target);
  const targetExport = targetModule
    ? checker
        .getExportsOfModule(targetModule)
        .find((entry) => entry.name === generatedSymbol)
    : undefined;
  if (!targetExport) return false;

  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    )
      continue;
    if (statement.moduleSpecifier.text !== importedPath) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const specifier of bindings.elements) {
      const exportName = specifier.propertyName?.text ?? specifier.name.text;
      if (
        exportName !== importedName ||
        specifier.isTypeOnly ||
        statement.importClause?.isTypeOnly
      )
        continue;
      const localSymbol = checker.getSymbolAtLocation(specifier.name);
      if (!localSymbol || !(localSymbol.flags & ts.SymbolFlags.Alias)) continue;
      const resolved = checker.getAliasedSymbol(localSymbol);
      if (resolved === targetExport) return true;
    }
  }
  return false;
}

function toProjectPath(path: Path): string {
  return normalize(`${PROJECT_ROOT}${path}` as Path);
}
