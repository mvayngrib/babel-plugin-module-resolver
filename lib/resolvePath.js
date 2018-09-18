'use strict';

exports.__esModule = true;
exports.default = resolvePath;

var _fs = require('fs');

var _fs2 = _interopRequireDefault(_fs);

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _log = require('./log');

var _mapToRelative = require('./mapToRelative');

var _mapToRelative2 = _interopRequireDefault(_mapToRelative);

var _normalizeOptions = require('./normalizeOptions');

var _normalizeOptions2 = _interopRequireDefault(_normalizeOptions);

var _utils = require('./utils');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var SEP_LENGTH = _path2.default.sep.length;
var NODE_MODULES = `${_path2.default.sep}node_modules${_path2.default.sep}`;

function getRelativePath(sourcePath, currentFile, absFileInRoot, opts) {
  var realSourceFileExtension = _path2.default.extname(absFileInRoot);
  var sourceFileExtension = _path2.default.extname(sourcePath);

  var relativePath = (0, _mapToRelative2.default)(opts.cwd, currentFile, absFileInRoot);
  if (realSourceFileExtension !== sourceFileExtension) {
    relativePath = (0, _utils.replaceExtension)(relativePath, opts);
  }

  return (0, _utils.toLocalPath)((0, _utils.toPosixPath)(relativePath));
}

function fromAbs(cwd, currentFile, abs) {
  return (0, _utils.toLocalPath)((0, _utils.toPosixPath)((0, _mapToRelative2.default)(cwd, currentFile, abs)));
}

function findPathInRoots(sourcePath, _ref) {
  var nodeResolvePath = _ref.nodeResolvePath,
      root = _ref.root;

  // Search the source path inside every custom root directory
  var resolvedSourceFile = void 0;

  root.some(function (basedir) {
    resolvedSourceFile = nodeResolvePath(`./${sourcePath}`, { basedir });
    return resolvedSourceFile !== null;
  });

  return resolvedSourceFile;
}

function getModuleDir(file) {
  // minus last slash
  var nodeModulesIdx = file.lastIndexOf(NODE_MODULES);
  if (nodeModulesIdx === -1) return null;

  var parentDirIdx = nodeModulesIdx + 12 + SEP_LENGTH;
  var parentDir = file.slice(0, parentDirIdx);
  var rest = file.slice(parentDirIdx + SEP_LENGTH);
  var sepIdx = rest.indexOf(_path2.default.sep);
  var endIdx = rest[0] === '@' ? rest.indexOf(_path2.default.sep, sepIdx + SEP_LENGTH) : sepIdx;
  return _path2.default.join(parentDir, rest.slice(0, endIdx));
}

function resolvePathFromRootConfig(sourcePath, currentFile, opts) {
  var absFileInRoot = findPathInRoots(sourcePath, opts);

  if (!absFileInRoot) {
    return null;
  }

  return getRelativePath(sourcePath, currentFile, absFileInRoot, opts);
}

function checkIfPackageExists(modulePath, currentFile, _ref2) {
  var nodeResolvePath = _ref2.nodeResolvePath;

  var resolvedPath = nodeResolvePath(modulePath, { basedir: currentFile });
  if (resolvedPath === null) {
    (0, _log.warn)(`Could not resolve "${modulePath}" in file ${currentFile}.`);
  }
}

function resolvePathFromAliasConfig(sourcePath, currentFile, opts) {
  var alias = opts.alias,
      aliasFields = opts.aliasFields,
      cwd = opts.cwd,
      nodeResolvePath = opts.nodeResolvePath;

  var aliasedSourceFile = void 0;

  alias.find(function (_ref3) {
    var regExp = _ref3[0],
        substitute = _ref3[1];

    var execResult = regExp.exec(sourcePath);

    if (execResult === null) {
      return false;
    }

    aliasedSourceFile = substitute(execResult);
    return true;
  });

  if (!aliasedSourceFile && aliasFields) {
    aliasedSourceFile = nodeResolvePath(sourcePath, { basedir: _path2.default.dirname(currentFile) });
    if (aliasedSourceFile) {
      return fromAbs(cwd, currentFile, aliasedSourceFile);
    }

    return null;
  }

  if (!aliasedSourceFile) {
    return null;
  }

  if ((0, _utils.isRelativePath)(aliasedSourceFile)) {
    return fromAbs(cwd, currentFile, aliasedSourceFile);
  }

  if (process.env.NODE_ENV !== 'production') {
    checkIfPackageExists(aliasedSourceFile, currentFile, opts);
  }

  return aliasedSourceFile;
}

function resolveDeduper(sourcePath, currentFile, opts) {
  var dedupeCache = opts.dedupeCache,
      cwd = opts.cwd,
      nodeResolvePath = opts.nodeResolvePath;

  if (!dedupeCache) {
    return null;
  }

  // this is necessary
  // also, in case we fail, let's not take a 2nd trip to resolvePathFromAliasConfig
  var dealiased = resolvePathFromAliasConfig(sourcePath, currentFile, opts);

  var resolvedSourceFile = nodeResolvePath(dealiased || sourcePath, {
    basedir: _path2.default.dirname(currentFile)
  });

  if (!resolvedSourceFile) {
    return dealiased;
  }

  var moduleDir = getModuleDir(resolvedSourceFile);
  var pkgJsonPath = moduleDir && _path2.default.join(moduleDir, 'package.json');
  if (!pkgJsonPath) {
    return dealiased;
  }

  var pathRelModuleDir = _path2.default.relative(moduleDir, resolvedSourceFile);

  // eslint-disable-next-line import/no-dynamic-require, global-require
  var pkg = require(pkgJsonPath);
  var dedupedName = `${pkg.name}@${pkg.version}/${pathRelModuleDir}`;
  if (!dedupeCache[dedupedName]) {
    // last check before we commit
    if (!_fs2.default.existsSync(resolvedSourceFile)) {
      return dealiased;
    }

    dedupeCache[dedupedName] = resolvedSourceFile;
  }

  var result = fromAbs(cwd, currentFile, dedupeCache[dedupedName]);
  return result;
}

var resolvers = [resolveDeduper, resolvePathFromAliasConfig, resolvePathFromRootConfig];

function resolvePath(sourcePath, currentFile, opts) {
  // avoid the whole @providesModule weirdness
  if (currentFile.includes('/react-native/Libraries/')) {
    return null;
  }

  if ((0, _utils.isRelativePath)(sourcePath)) {
    return sourcePath;
  }

  var normalizedOpts = (0, _normalizeOptions2.default)(currentFile, opts);

  // File param is a relative path from the environment current working directory
  // (not from cwd param)
  var absoluteCurrentFile = _path2.default.resolve(currentFile);
  var resolvedPath = null;

  resolvers.some(function (resolver) {
    resolvedPath = resolver(sourcePath, absoluteCurrentFile, normalizedOpts);
    return resolvedPath !== null;
  });

  return resolvedPath;
}