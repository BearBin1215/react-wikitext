import ts from "typescript";

export interface ModuleReference {
  readonly specifier: string;
  readonly kind: "value" | "type";
}

function bindingKind(bindings: ts.NamedImportBindings | ts.NamedExportBindings): "value" | "type" {
  if (ts.isNamespaceImport(bindings) || ts.isNamespaceExport(bindings)) {
    return "value";
  }
  return bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly)
    ? "type"
    : "value";
}

function importKind(node: ts.ImportDeclaration): "value" | "type" {
  const clause = node.importClause;
  if (!clause) {
    return "value";
  }
  if (clause.isTypeOnly || clause.name) {
    return clause.isTypeOnly ? "type" : "value";
  }
  return clause.namedBindings ? bindingKind(clause.namedBindings) : "value";
}

function exportKind(node: ts.ExportDeclaration): "value" | "type" {
  if (node.isTypeOnly) {
    return "type";
  }
  return node.exportClause ? bindingKind(node.exportClause) : "value";
}

/** 解析源码中的 import、re-export 与字面量动态 import，并区分类型与值引用。 */
export function moduleReferences(fileName: string, code: string): ModuleReference[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const references: ModuleReference[] = [];
  const add = (specifier: ts.Expression | undefined, kind: "value" | "type"): void => {
    if (specifier && ts.isStringLiteral(specifier)) {
      references.push({ specifier: specifier.text, kind });
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      add(node.moduleSpecifier, importKind(node));
      return;
    }
    if (ts.isExportDeclaration(node)) {
      add(node.moduleSpecifier, exportKind(node));
      return;
    }
    if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument)) {
        add(argument.literal, "type");
      }
      return;
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      add(node.arguments[0], "value");
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return references;
}
