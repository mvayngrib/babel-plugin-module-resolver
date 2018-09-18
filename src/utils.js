import path from 'path';
import resolve from 'resolve';
import browserResolve from 'browser-resolve';

export function nodeResolvePath(modulePath, { basedir, extensions, aliasFields }) {
  let defaultPath
  try {
    defaultPath = resolve.sync(modulePath, { basedir, extensions });
  } catch (e) {
    defaultPath = null;
  }

  if (!aliasFields) {
    return defaultPath;
  }

  let dealiased = null;
  aliasFields.some(alias => {
    try {
      dealiased = browserResolve.sync(modulePath, { basedir, browser: alias });
    } catch (e) {
      return false;
    }

    return dealiased !== defaultPath;
  })

  return dealiased;
}

export function isRelativePath(nodePath) {
  return nodePath.match(/^\.?\.\//);
}

export function toPosixPath(modulePath) {
  return modulePath.replace(/\\/g, '/');
}

export function toLocalPath(modulePath) {
  let localPath = modulePath.replace(/\/index$/, ''); // remove trailing /index
  if (!isRelativePath(localPath)) {
    localPath = `./${localPath}`; // insert `./` to make it a relative path
  }
  return localPath;
}

export function stripExtension(modulePath, stripExtensions) {
  let name = path.basename(modulePath);
  stripExtensions.some(extension => {
    if (name.endsWith(extension)) {
      name = name.slice(0, name.length - extension.length);
      return true;
    }
    return false;
  });
  return name;
}

export function replaceExtension(modulePath, opts) {
  const filename = stripExtension(modulePath, opts.stripExtensions);
  return path.join(path.dirname(modulePath), filename);
}

export function matchesPattern(types, calleePath, pattern) {
  const { node } = calleePath;

  if (types.isMemberExpression(node)) {
    return calleePath.matchesPattern(pattern);
  }

  if (!types.isIdentifier(node) || pattern.includes('.')) {
    return false;
  }

  const name = pattern.split('.')[0];

  return node.name === name;
}

export function mapPathString(nodePath, state) {
  if (!state.types.isStringLiteral(nodePath)) {
    return;
  }

  const sourcePath = nodePath.node.value;
  const currentFile = state.file.opts.filename;

  const modulePath = state.normalizedOpts.resolvePath(sourcePath, currentFile, state.opts);
  if (modulePath) {
    if (nodePath.node.pathResolved) {
      return;
    }

    nodePath.replaceWith(state.types.stringLiteral(modulePath));
    nodePath.node.pathResolved = true;
  }
}

export function isImportCall(types, calleePath) {
  return types.isImport(calleePath.node.callee);
}

export function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
