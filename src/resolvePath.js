import fs from 'fs';
import path from 'path';

import { warn } from './log';
import mapToRelative from './mapToRelative';
import normalizeOptions from './normalizeOptions';
import {
  // nodeResolvePath,
  replaceExtension,
  isRelativePath,
  toLocalPath,
  toPosixPath,
} from './utils';

const SEP_LENGTH = path.sep.length
const NODE_MODULES = `${path.sep}node_modules${path.sep}`

function getRelativePath(sourcePath, currentFile, absFileInRoot, opts) {
  const realSourceFileExtension = path.extname(absFileInRoot);
  const sourceFileExtension = path.extname(sourcePath);

  let relativePath = mapToRelative(opts.cwd, currentFile, absFileInRoot);
  if (realSourceFileExtension !== sourceFileExtension) {
    relativePath = replaceExtension(relativePath, opts);
  }

  return toLocalPath(toPosixPath(relativePath));
}

function fromAbs(cwd, currentFile, abs) {
  return toLocalPath(toPosixPath(mapToRelative(cwd, currentFile, abs)))
}

function findPathInRoots(sourcePath, { nodeResolvePath, root }) {
  // Search the source path inside every custom root directory
  let resolvedSourceFile;

  root.some((basedir) => {
    resolvedSourceFile = nodeResolvePath(`./${sourcePath}`, { basedir });
    return resolvedSourceFile !== null;
  });

  return resolvedSourceFile;
}

function getModuleDir(file) {
  // minus last slash
  const nodeModulesIdx = file.lastIndexOf(NODE_MODULES);
  if (nodeModulesIdx === -1) return null;

  const parentDirIdx = nodeModulesIdx + 12 + SEP_LENGTH;
  const parentDir = file.slice(0, parentDirIdx);
  const rest = file.slice(parentDirIdx + SEP_LENGTH);
  const sepIdx = rest.indexOf(path.sep)
  const endIdx = rest[0] === '@' ? rest.indexOf(path.sep, sepIdx + SEP_LENGTH) : sepIdx;
  return path.join(parentDir, rest.slice(0, endIdx));
}

function getPackageJsonPathForFile(file) {
  const moduleDir = getModuleDir(file);
  return moduleDir && path.join(moduleDir, 'package.json');
}

function resolvePathFromRootConfig(sourcePath, currentFile, opts) {
  const absFileInRoot = findPathInRoots(sourcePath, opts);

  if (!absFileInRoot) {
    return null;
  }

  return getRelativePath(sourcePath, currentFile, absFileInRoot, opts);
}

function checkIfPackageExists(modulePath, currentFile, { nodeResolvePath }) {
  const resolvedPath = nodeResolvePath(modulePath, { basedir: currentFile });
  if (resolvedPath === null) {
    warn(`Could not resolve "${modulePath}" in file ${currentFile}.`);
  }
}

function resolvePathFromAliasConfig(sourcePath, currentFile, opts) {
  const { alias, aliasFields, cwd, nodeResolvePath, } = opts;
  let aliasedSourceFile;

  alias.find(([regExp, substitute]) => {
    const execResult = regExp.exec(sourcePath);

    if (execResult === null) {
      return false;
    }

    aliasedSourceFile = substitute(execResult);
    return true;
  });

  if (!aliasedSourceFile && aliasFields) {
    aliasedSourceFile = nodeResolvePath(sourcePath, { basedir: path.dirname(currentFile) });
    if (aliasedSourceFile) {
      return fromAbs(cwd, currentFile, aliasedSourceFile);
    }

    return null;
  }

  if (!aliasedSourceFile) {
    return null;
  }

  if (isRelativePath(aliasedSourceFile)) {
    return fromAbs(cwd, currentFile, aliasedSourceFile);
  }

  if (process.env.NODE_ENV !== 'production') {
    checkIfPackageExists(aliasedSourceFile, currentFile, opts);
  }

  return aliasedSourceFile;
}

function resolveDeduper(sourcePath, currentFile, opts) {
  const { dedupeCache, cwd, nodeResolvePath } = opts;
  if (!dedupeCache) {
    return null;
  }

  // avoid the whole @providesModule weirdness
  if (currentFile.includes('/react-native/Libraries/')) {
    return null;
  };

  // this is necessary
  // also, in case we fail, let's not take a 2nd trip to resolvePathFromAliasConfig
  const dealiased = resolvePathFromAliasConfig(sourcePath, currentFile, opts);

  const resolvedSourceFile = nodeResolvePath(dealiased || sourcePath, {
    basedir: path.dirname(currentFile),
  });

  if (!resolvedSourceFile) {
    return dealiased;
  }

  const pkgJsonPath = getPackageJsonPathForFile(resolvedSourceFile);
  if (!pkgJsonPath) {
    return dealiased;
  }

  // eslint-disable-next-line import/no-dynamic-require, global-require
  const pkg = require(pkgJsonPath);
  const nameAndVersion = `${pkg.name}@${pkg.version}`;
  if (!dedupeCache[nameAndVersion]) {
    // last check before we commit
    if (!fs.existsSync(resolvedSourceFile)) {
      return dealiased;
    }

    dedupeCache[nameAndVersion] = resolvedSourceFile;
  }

  const result = fromAbs(cwd, currentFile, dedupeCache[nameAndVersion]);
  return result;
}

const resolvers = [
  resolveDeduper,
  resolvePathFromAliasConfig,
  resolvePathFromRootConfig,
];

export default function resolvePath(sourcePath, currentFile, opts) {
  if (isRelativePath(sourcePath)) {
    return sourcePath;
  }

  const normalizedOpts = normalizeOptions(currentFile, opts);

  // File param is a relative path from the environment current working directory
  // (not from cwd param)
  const absoluteCurrentFile = path.resolve(currentFile);
  let resolvedPath = null;

  resolvers.some((resolver) => {
    resolvedPath = resolver(sourcePath, absoluteCurrentFile, normalizedOpts);
    return resolvedPath !== null;
  });

  return resolvedPath;
}
