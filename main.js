var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/adm-zip/util/constants.js
var require_constants = __commonJS({
  "node_modules/adm-zip/util/constants.js"(exports, module2) {
    module2.exports = {
      /* The local file header */
      LOCHDR: 30,
      // LOC header size
      LOCSIG: 67324752,
      // "PK\003\004"
      LOCVER: 4,
      // version needed to extract
      LOCFLG: 6,
      // general purpose bit flag
      LOCHOW: 8,
      // compression method
      LOCTIM: 10,
      // modification time (2 bytes time, 2 bytes date)
      LOCCRC: 14,
      // uncompressed file crc-32 value
      LOCSIZ: 18,
      // compressed size
      LOCLEN: 22,
      // uncompressed size
      LOCNAM: 26,
      // filename length
      LOCEXT: 28,
      // extra field length
      /* The Data descriptor */
      EXTSIG: 134695760,
      // "PK\007\008"
      EXTHDR: 16,
      // EXT header size
      EXTCRC: 4,
      // uncompressed file crc-32 value
      EXTSIZ: 8,
      // compressed size
      EXTLEN: 12,
      // uncompressed size
      /* The central directory file header */
      CENHDR: 46,
      // CEN header size
      CENSIG: 33639248,
      // "PK\001\002"
      CENVEM: 4,
      // version made by
      CENVER: 6,
      // version needed to extract
      CENFLG: 8,
      // encrypt, decrypt flags
      CENHOW: 10,
      // compression method
      CENTIM: 12,
      // modification time (2 bytes time, 2 bytes date)
      CENCRC: 16,
      // uncompressed file crc-32 value
      CENSIZ: 20,
      // compressed size
      CENLEN: 24,
      // uncompressed size
      CENNAM: 28,
      // filename length
      CENEXT: 30,
      // extra field length
      CENCOM: 32,
      // file comment length
      CENDSK: 34,
      // volume number start
      CENATT: 36,
      // internal file attributes
      CENATX: 38,
      // external file attributes (host system dependent)
      CENOFF: 42,
      // LOC header offset
      /* The entries in the end of central directory */
      ENDHDR: 22,
      // END header size
      ENDSIG: 101010256,
      // "PK\005\006"
      ENDSUB: 8,
      // number of entries on this disk
      ENDTOT: 10,
      // total number of entries
      ENDSIZ: 12,
      // central directory size in bytes
      ENDOFF: 16,
      // offset of first CEN header
      ENDCOM: 20,
      // zip file comment length
      END64HDR: 20,
      // zip64 END header size
      END64SIG: 117853008,
      // zip64 Locator signature, "PK\006\007"
      END64START: 4,
      // number of the disk with the start of the zip64
      END64OFF: 8,
      // relative offset of the zip64 end of central directory
      END64NUMDISKS: 16,
      // total number of disks
      ZIP64SIG: 101075792,
      // zip64 signature, "PK\006\006"
      ZIP64HDR: 56,
      // zip64 record minimum size
      ZIP64LEAD: 12,
      // leading bytes at the start of the record, not counted by the value stored in ZIP64SIZE
      ZIP64SIZE: 4,
      // zip64 size of the central directory record
      ZIP64VEM: 12,
      // zip64 version made by
      ZIP64VER: 14,
      // zip64 version needed to extract
      ZIP64DSK: 16,
      // zip64 number of this disk
      ZIP64DSKDIR: 20,
      // number of the disk with the start of the record directory
      ZIP64SUB: 24,
      // number of entries on this disk
      ZIP64TOT: 32,
      // total number of entries
      ZIP64SIZB: 40,
      // zip64 central directory size in bytes
      ZIP64OFF: 48,
      // offset of start of central directory with respect to the starting disk number
      ZIP64EXTRA: 56,
      // extensible data sector
      /* Compression methods */
      STORED: 0,
      // no compression
      SHRUNK: 1,
      // shrunk
      REDUCED1: 2,
      // reduced with compression factor 1
      REDUCED2: 3,
      // reduced with compression factor 2
      REDUCED3: 4,
      // reduced with compression factor 3
      REDUCED4: 5,
      // reduced with compression factor 4
      IMPLODED: 6,
      // imploded
      // 7 reserved for Tokenizing compression algorithm
      DEFLATED: 8,
      // deflated
      ENHANCED_DEFLATED: 9,
      // enhanced deflated
      PKWARE: 10,
      // PKWare DCL imploded
      // 11 reserved by PKWARE
      BZIP2: 12,
      //  compressed using BZIP2
      // 13 reserved by PKWARE
      LZMA: 14,
      // LZMA
      // 15-17 reserved by PKWARE
      IBM_TERSE: 18,
      // compressed using IBM TERSE
      IBM_LZ77: 19,
      // IBM LZ77 z
      AES_ENCRYPT: 99,
      // WinZIP AES encryption method
      /* General purpose bit flag */
      // values can obtained with expression 2**bitnr
      FLG_ENC: 1,
      // Bit 0: encrypted file
      FLG_COMP1: 2,
      // Bit 1, compression option
      FLG_COMP2: 4,
      // Bit 2, compression option
      FLG_DESC: 8,
      // Bit 3, data descriptor
      FLG_ENH: 16,
      // Bit 4, enhanced deflating
      FLG_PATCH: 32,
      // Bit 5, indicates that the file is compressed patched data.
      FLG_STR: 64,
      // Bit 6, strong encryption (patented)
      // Bits 7-10: Currently unused.
      FLG_EFS: 2048,
      // Bit 11: Language encoding flag (EFS)
      // Bit 12: Reserved by PKWARE for enhanced compression.
      // Bit 13: encrypted the Central Directory (patented).
      // Bits 14-15: Reserved by PKWARE.
      FLG_MSK: 4096,
      // mask header values
      /* Load type */
      FILE: 2,
      BUFFER: 1,
      NONE: 0,
      /* 4.5 Extensible data fields */
      EF_ID: 0,
      EF_SIZE: 2,
      /* Header IDs */
      ID_ZIP64: 1,
      ID_AVINFO: 7,
      ID_PFS: 8,
      ID_OS2: 9,
      ID_NTFS: 10,
      ID_OPENVMS: 12,
      ID_UNIX: 13,
      ID_FORK: 14,
      ID_PATCH: 15,
      ID_X509_PKCS7: 20,
      ID_X509_CERTID_F: 21,
      ID_X509_CERTID_C: 22,
      ID_STRONGENC: 23,
      ID_RECORD_MGT: 24,
      ID_X509_PKCS7_RL: 25,
      ID_IBM1: 101,
      ID_IBM2: 102,
      ID_POSZIP: 18064,
      EF_ZIP64_OR_32: 4294967295,
      EF_ZIP64_OR_16: 65535,
      EF_ZIP64_SUNCOMP: 0,
      EF_ZIP64_SCOMP: 8,
      EF_ZIP64_RHO: 16,
      EF_ZIP64_DSN: 24
    };
  }
});

// node_modules/adm-zip/util/errors.js
var require_errors = __commonJS({
  "node_modules/adm-zip/util/errors.js"(exports) {
    var errors = {
      /* Header error messages */
      INVALID_LOC: "Invalid LOC header (bad signature)",
      INVALID_CEN: "Invalid CEN header (bad signature)",
      INVALID_END: "Invalid END header (bad signature)",
      /* Descriptor */
      DESCRIPTOR_NOT_EXIST: "No descriptor present",
      DESCRIPTOR_UNKNOWN: "Unknown descriptor format",
      DESCRIPTOR_FAULTY: "Descriptor data is malformed",
      /* ZipEntry error messages*/
      NO_DATA: "Nothing to decompress",
      BAD_CRC: "CRC32 checksum failed {0}",
      FILE_IN_THE_WAY: "There is a file in the way: {0}",
      UNKNOWN_METHOD: "Invalid/unsupported compression method",
      /* Inflater error messages */
      AVAIL_DATA: "inflate::Available inflate data did not terminate",
      INVALID_DISTANCE: "inflate::Invalid literal/length or distance code in fixed or dynamic block",
      TO_MANY_CODES: "inflate::Dynamic block code description: too many length or distance codes",
      INVALID_REPEAT_LEN: "inflate::Dynamic block code description: repeat more than specified lengths",
      INVALID_REPEAT_FIRST: "inflate::Dynamic block code description: repeat lengths with no first length",
      INCOMPLETE_CODES: "inflate::Dynamic block code description: code lengths codes incomplete",
      INVALID_DYN_DISTANCE: "inflate::Dynamic block code description: invalid distance code lengths",
      INVALID_CODES_LEN: "inflate::Dynamic block code description: invalid literal/length code lengths",
      INVALID_STORE_BLOCK: "inflate::Stored block length did not match one's complement",
      INVALID_BLOCK_TYPE: "inflate::Invalid block type (type == 3)",
      /* ADM-ZIP error messages */
      CANT_EXTRACT_FILE: "Could not extract the file",
      CANT_OVERRIDE: "Target file already exists",
      DISK_ENTRY_TOO_LARGE: "Number of disk entries is too large",
      NO_ZIP: "No zip file was loaded",
      NO_ENTRY: "Entry doesn't exist",
      DIRECTORY_CONTENT_ERROR: "A directory cannot have content",
      FILE_NOT_FOUND: 'File not found: "{0}"',
      NOT_IMPLEMENTED: "Not implemented",
      INVALID_FILENAME: "Invalid filename",
      INVALID_FORMAT: "Invalid or unsupported zip format. No END header found",
      INVALID_PASS_PARAM: "Incompatible password parameter",
      WRONG_PASSWORD: "Wrong Password",
      /* ADM-ZIP */
      COMMENT_TOO_LONG: "Comment is too long",
      // Comment can be max 65535 bytes long (NOTE: some non-US characters may take more space)
      EXTRA_FIELD_PARSE_ERROR: "Extra field parsing error"
    };
    function E(message) {
      return function(...args) {
        if (args.length) {
          message = message.replace(/\{(\d)\}/g, (_, n) => args[n] || "");
        }
        return new Error("ADM-ZIP: " + message);
      };
    }
    for (const msg of Object.keys(errors)) {
      exports[msg] = E(errors[msg]);
    }
  }
});

// node_modules/adm-zip/util/utils.js
var require_utils = __commonJS({
  "node_modules/adm-zip/util/utils.js"(exports, module2) {
    var fsystem = require("fs");
    var pth = require("path");
    var Constants = require_constants();
    var Errors = require_errors();
    var isWin = typeof process === "object" && "win32" === process.platform;
    var is_Obj = (obj) => typeof obj === "object" && obj !== null;
    var crcTable = new Uint32Array(256).map((t, c) => {
      for (let k = 0; k < 8; k++) {
        if ((c & 1) !== 0) {
          c = 3988292384 ^ c >>> 1;
        } else {
          c >>>= 1;
        }
      }
      return c >>> 0;
    });
    function Utils(opts) {
      this.sep = pth.sep;
      this.fs = fsystem;
      if (is_Obj(opts)) {
        if (is_Obj(opts.fs) && typeof opts.fs.statSync === "function") {
          this.fs = opts.fs;
        }
      }
    }
    module2.exports = Utils;
    Utils.prototype.makeDir = function(folder) {
      const self = this;
      function mkdirSync(fpath) {
        let resolvedPath = fpath.split(self.sep)[0];
        fpath.split(self.sep).forEach(function(name) {
          if (!name || name.substr(-1, 1) === ":") return;
          resolvedPath += self.sep + name;
          var stat;
          try {
            stat = self.fs.statSync(resolvedPath);
          } catch (e) {
            if (e.message && e.message.startsWith("ENOENT")) {
              self.fs.mkdirSync(resolvedPath);
            } else {
              throw e;
            }
          }
          if (stat && stat.isFile()) throw Errors.FILE_IN_THE_WAY(`"${resolvedPath}"`);
        });
      }
      mkdirSync(folder);
    };
    Utils.prototype.writeFileTo = function(path5, content, overwrite, attr) {
      const self = this;
      if (self.fs.existsSync(path5)) {
        if (!overwrite) return false;
        var stat = self.fs.statSync(path5);
        if (stat.isDirectory()) {
          return false;
        }
      }
      var folder = pth.dirname(path5);
      if (!self.fs.existsSync(folder)) {
        self.makeDir(folder);
      }
      var fd;
      try {
        fd = self.fs.openSync(path5, "w", 438);
      } catch (e) {
        self.fs.chmodSync(path5, 438);
        fd = self.fs.openSync(path5, "w", 438);
      }
      if (fd) {
        try {
          self.fs.writeSync(fd, content, 0, content.length, 0);
        } finally {
          self.fs.closeSync(fd);
        }
      }
      self.fs.chmodSync(path5, attr || 438);
      return true;
    };
    Utils.prototype.writeFileToAsync = function(path5, content, overwrite, attr, callback) {
      if (typeof attr === "function") {
        callback = attr;
        attr = void 0;
      }
      const self = this;
      self.fs.exists(path5, function(exist) {
        if (exist && !overwrite) return callback(false);
        self.fs.stat(path5, function(err, stat) {
          if (exist && stat.isDirectory()) {
            return callback(false);
          }
          var folder = pth.dirname(path5);
          self.fs.exists(folder, function(exists) {
            if (!exists) self.makeDir(folder);
            self.fs.open(path5, "w", 438, function(err2, fd) {
              if (err2) {
                self.fs.chmod(path5, 438, function() {
                  self.fs.open(path5, "w", 438, function(err3, fd2) {
                    self.fs.write(fd2, content, 0, content.length, 0, function() {
                      self.fs.close(fd2, function() {
                        self.fs.chmod(path5, attr || 438, function() {
                          callback(true);
                        });
                      });
                    });
                  });
                });
              } else if (fd) {
                self.fs.write(fd, content, 0, content.length, 0, function() {
                  self.fs.close(fd, function() {
                    self.fs.chmod(path5, attr || 438, function() {
                      callback(true);
                    });
                  });
                });
              } else {
                self.fs.chmod(path5, attr || 438, function() {
                  callback(true);
                });
              }
            });
          });
        });
      });
    };
    Utils.prototype.findFiles = function(path5) {
      const self = this;
      function findSync(dir, pattern, recursive) {
        if (typeof pattern === "boolean") {
          recursive = pattern;
          pattern = void 0;
        }
        let files = [];
        self.fs.readdirSync(dir).forEach(function(file) {
          const path6 = pth.join(dir, file);
          const stat = self.fs.statSync(path6);
          if (!pattern || pattern.test(path6)) {
            files.push(pth.normalize(path6) + (stat.isDirectory() ? self.sep : ""));
          }
          if (stat.isDirectory() && recursive) files = files.concat(findSync(path6, pattern, recursive));
        });
        return files;
      }
      return findSync(path5, void 0, true);
    };
    Utils.prototype.findFilesAsync = function(dir, cb) {
      const self = this;
      let results = [];
      self.fs.readdir(dir, function(err, list) {
        if (err) return cb(err);
        let list_length = list.length;
        if (!list_length) return cb(null, results);
        list.forEach(function(file) {
          file = pth.join(dir, file);
          self.fs.stat(file, function(err2, stat) {
            if (err2) return cb(err2);
            if (stat) {
              results.push(pth.normalize(file) + (stat.isDirectory() ? self.sep : ""));
              if (stat.isDirectory()) {
                self.findFilesAsync(file, function(err3, res) {
                  if (err3) return cb(err3);
                  results = results.concat(res);
                  if (!--list_length) cb(null, results);
                });
              } else {
                if (!--list_length) cb(null, results);
              }
            }
          });
        });
      });
    };
    Utils.prototype.getAttributes = function() {
    };
    Utils.prototype.setAttributes = function() {
    };
    Utils.crc32update = function(crc, byte) {
      return crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
    };
    Utils.crc32 = function(buf) {
      if (typeof buf === "string") {
        buf = Buffer.from(buf, "utf8");
      }
      let len = buf.length;
      let crc = ~0;
      for (let off = 0; off < len; ) crc = Utils.crc32update(crc, buf[off++]);
      return ~crc >>> 0;
    };
    Utils.methodToString = function(method) {
      switch (method) {
        case Constants.STORED:
          return "STORED (" + method + ")";
        case Constants.DEFLATED:
          return "DEFLATED (" + method + ")";
        default:
          return "UNSUPPORTED (" + method + ")";
      }
    };
    Utils.canonical = function(path5) {
      if (!path5) return "";
      const safeSuffix = pth.posix.normalize("/" + path5.split("\\").join("/"));
      return pth.join(".", safeSuffix);
    };
    Utils.zipnamefix = function(path5) {
      if (!path5) return "";
      const safeSuffix = pth.posix.normalize("/" + path5.split("\\").join("/"));
      return pth.posix.join(".", safeSuffix);
    };
    Utils.findLast = function(arr, callback) {
      if (!Array.isArray(arr)) throw new TypeError("arr is not array");
      const len = arr.length >>> 0;
      for (let i = len - 1; i >= 0; i--) {
        if (callback(arr[i], i, arr)) {
          return arr[i];
        }
      }
      return void 0;
    };
    Utils.sanitize = function(prefix, name) {
      prefix = pth.resolve(pth.normalize(prefix));
      var parts = name.split("/");
      for (var i = 0, l = parts.length; i < l; i++) {
        var path5 = pth.normalize(pth.join(prefix, parts.slice(i, l).join(pth.sep)));
        if (path5 === prefix || path5.startsWith(prefix + pth.sep)) {
          return path5;
        }
      }
      return pth.normalize(pth.join(prefix, pth.basename(name)));
    };
    Utils.toBuffer = function toBuffer(input, encoder) {
      if (Buffer.isBuffer(input)) {
        return input;
      } else if (input instanceof Uint8Array) {
        return Buffer.from(input);
      } else {
        return typeof input === "string" ? encoder(input) : Buffer.alloc(0);
      }
    };
    Utils.readBigUInt64LE = function(buffer, index) {
      const lo = buffer.readUInt32LE(index);
      const hi = buffer.readUInt32LE(index + 4);
      return hi * 4294967296 + lo;
    };
    Utils.writeBigUInt64LE = function(buffer, value, index) {
      const lo = value >>> 0;
      const hi = Math.floor(value / 4294967296) >>> 0;
      buffer.writeUInt32LE(lo, index);
      buffer.writeUInt32LE(hi, index + 4);
    };
    Utils.fromDOS2Date = function(val) {
      return new Date((val >> 25 & 127) + 1980, Math.max((val >> 21 & 15) - 1, 0), Math.max(val >> 16 & 31, 1), val >> 11 & 31, val >> 5 & 63, (val & 31) << 1);
    };
    Utils.fromDate2DOS = function(val) {
      let date = 0;
      let time = 0;
      if (val.getFullYear() > 1979) {
        date = (val.getFullYear() - 1980 & 127) << 9 | val.getMonth() + 1 << 5 | val.getDate();
        time = val.getHours() << 11 | val.getMinutes() << 5 | val.getSeconds() >> 1;
      }
      return date << 16 | time;
    };
    Utils.isWin = isWin;
    Utils.crcTable = crcTable;
  }
});

// node_modules/adm-zip/util/fattr.js
var require_fattr = __commonJS({
  "node_modules/adm-zip/util/fattr.js"(exports, module2) {
    var pth = require("path");
    module2.exports = function(path5, { fs }) {
      var _path = path5 || "", _obj = newAttr(), _stat = null;
      function newAttr() {
        return {
          directory: false,
          readonly: false,
          hidden: false,
          executable: false,
          mtime: 0,
          atime: 0
        };
      }
      if (_path && fs.existsSync(_path)) {
        _stat = fs.statSync(_path);
        _obj.directory = _stat.isDirectory();
        _obj.mtime = _stat.mtime;
        _obj.atime = _stat.atime;
        _obj.executable = (73 & _stat.mode) !== 0;
        _obj.readonly = (128 & _stat.mode) === 0;
        _obj.hidden = pth.basename(_path)[0] === ".";
      } else {
        console.warn("Invalid path: " + _path);
      }
      return {
        get directory() {
          return _obj.directory;
        },
        get readOnly() {
          return _obj.readonly;
        },
        get hidden() {
          return _obj.hidden;
        },
        get mtime() {
          return _obj.mtime;
        },
        get atime() {
          return _obj.atime;
        },
        get executable() {
          return _obj.executable;
        },
        decodeAttributes: function() {
        },
        encodeAttributes: function() {
        },
        toJSON: function() {
          return {
            path: _path,
            isDirectory: _obj.directory,
            isReadOnly: _obj.readonly,
            isHidden: _obj.hidden,
            isExecutable: _obj.executable,
            mTime: _obj.mtime,
            aTime: _obj.atime
          };
        },
        toString: function() {
          return JSON.stringify(this.toJSON(), null, "	");
        }
      };
    };
  }
});

// node_modules/adm-zip/util/decoder.js
var require_decoder = __commonJS({
  "node_modules/adm-zip/util/decoder.js"(exports, module2) {
    module2.exports = {
      efs: true,
      encode: (data) => Buffer.from(data, "utf8"),
      decode: (data) => data.toString("utf8")
    };
  }
});

// node_modules/adm-zip/util/index.js
var require_util = __commonJS({
  "node_modules/adm-zip/util/index.js"(exports, module2) {
    module2.exports = require_utils();
    module2.exports.Constants = require_constants();
    module2.exports.Errors = require_errors();
    module2.exports.FileAttr = require_fattr();
    module2.exports.decoder = require_decoder();
  }
});

// node_modules/adm-zip/headers/entryHeader.js
var require_entryHeader = __commonJS({
  "node_modules/adm-zip/headers/entryHeader.js"(exports, module2) {
    var Utils = require_util();
    var Constants = Utils.Constants;
    module2.exports = function() {
      var _verMade = 20, _version = 10, _flags = 0, _method = 0, _time = 0, _crc = 0, _compressedSize = 0, _size = 0, _fnameLen = 0, _extraLen = 0, _comLen = 0, _diskStart = 0, _inattr = 0, _attr = 0, _offset = 0;
      _verMade |= Utils.isWin ? 2560 : 768;
      _flags |= Constants.FLG_EFS;
      const _localHeader = {
        extraLen: 0
      };
      const uint32 = (val) => Math.max(0, val) >>> 0;
      const uint16 = (val) => Math.max(0, val) & 65535;
      const uint8 = (val) => Math.max(0, val) & 255;
      _time = Utils.fromDate2DOS(/* @__PURE__ */ new Date());
      return {
        get made() {
          return _verMade;
        },
        set made(val) {
          _verMade = val;
        },
        get version() {
          return _version;
        },
        set version(val) {
          _version = val;
        },
        get flags() {
          return _flags;
        },
        set flags(val) {
          _flags = val;
        },
        get flags_efs() {
          return (_flags & Constants.FLG_EFS) > 0;
        },
        set flags_efs(val) {
          if (val) {
            _flags |= Constants.FLG_EFS;
          } else {
            _flags &= ~Constants.FLG_EFS;
          }
        },
        get flags_desc() {
          return (_flags & Constants.FLG_DESC) > 0;
        },
        set flags_desc(val) {
          if (val) {
            _flags |= Constants.FLG_DESC;
          } else {
            _flags &= ~Constants.FLG_DESC;
          }
        },
        get method() {
          return _method;
        },
        set method(val) {
          switch (val) {
            case Constants.STORED:
              this.version = 10;
              break;
            case Constants.DEFLATED:
            default:
              this.version = 20;
          }
          _method = val;
        },
        get time() {
          return Utils.fromDOS2Date(this.timeval);
        },
        set time(val) {
          val = new Date(val);
          this.timeval = Utils.fromDate2DOS(val);
        },
        get timeval() {
          return _time;
        },
        set timeval(val) {
          _time = uint32(val);
        },
        get timeHighByte() {
          return uint8(_time >>> 8);
        },
        get crc() {
          return _crc;
        },
        set crc(val) {
          _crc = uint32(val);
        },
        get compressedSize() {
          return _compressedSize;
        },
        set compressedSize(val) {
          _compressedSize = uint32(val);
        },
        get size() {
          return _size;
        },
        set size(val) {
          _size = uint32(val);
        },
        get fileNameLength() {
          return _fnameLen;
        },
        set fileNameLength(val) {
          _fnameLen = val;
        },
        get extraLength() {
          return _extraLen;
        },
        set extraLength(val) {
          _extraLen = val;
        },
        get extraLocalLength() {
          return _localHeader.extraLen;
        },
        set extraLocalLength(val) {
          _localHeader.extraLen = val;
        },
        get commentLength() {
          return _comLen;
        },
        set commentLength(val) {
          _comLen = val;
        },
        get diskNumStart() {
          return _diskStart;
        },
        set diskNumStart(val) {
          _diskStart = uint32(val);
        },
        get inAttr() {
          return _inattr;
        },
        set inAttr(val) {
          _inattr = uint32(val);
        },
        get attr() {
          return _attr;
        },
        set attr(val) {
          _attr = uint32(val);
        },
        // get Unix file permissions
        get fileAttr() {
          return (_attr || 0) >> 16 & 4095;
        },
        get offset() {
          return _offset;
        },
        set offset(val) {
          _offset = uint32(val);
        },
        get encrypted() {
          return (_flags & Constants.FLG_ENC) === Constants.FLG_ENC;
        },
        get centralHeaderSize() {
          return Constants.CENHDR + _fnameLen + _extraLen + _comLen;
        },
        get realDataOffset() {
          return _offset + Constants.LOCHDR + _localHeader.fnameLen + _localHeader.extraLen;
        },
        get localHeader() {
          return _localHeader;
        },
        loadLocalHeaderFromBinary: function(input) {
          var data = input.slice(_offset, _offset + Constants.LOCHDR);
          if (data.readUInt32LE(0) !== Constants.LOCSIG) {
            throw Utils.Errors.INVALID_LOC();
          }
          _localHeader.version = data.readUInt16LE(Constants.LOCVER);
          _localHeader.flags = data.readUInt16LE(Constants.LOCFLG);
          _localHeader.flags_desc = (_localHeader.flags & Constants.FLG_DESC) > 0;
          _localHeader.method = data.readUInt16LE(Constants.LOCHOW);
          _localHeader.time = data.readUInt32LE(Constants.LOCTIM);
          _localHeader.crc = data.readUInt32LE(Constants.LOCCRC);
          _localHeader.compressedSize = data.readUInt32LE(Constants.LOCSIZ);
          _localHeader.size = data.readUInt32LE(Constants.LOCLEN);
          _localHeader.fnameLen = data.readUInt16LE(Constants.LOCNAM);
          _localHeader.extraLen = data.readUInt16LE(Constants.LOCEXT);
          const extraStart = _offset + Constants.LOCHDR + _localHeader.fnameLen;
          const extraEnd = extraStart + _localHeader.extraLen;
          return input.slice(extraStart, extraEnd);
        },
        loadFromBinary: function(data) {
          if (data.length !== Constants.CENHDR || data.readUInt32LE(0) !== Constants.CENSIG) {
            throw Utils.Errors.INVALID_CEN();
          }
          _verMade = data.readUInt16LE(Constants.CENVEM);
          _version = data.readUInt16LE(Constants.CENVER);
          _flags = data.readUInt16LE(Constants.CENFLG);
          _method = data.readUInt16LE(Constants.CENHOW);
          _time = data.readUInt32LE(Constants.CENTIM);
          _crc = data.readUInt32LE(Constants.CENCRC);
          _compressedSize = data.readUInt32LE(Constants.CENSIZ);
          _size = data.readUInt32LE(Constants.CENLEN);
          _fnameLen = data.readUInt16LE(Constants.CENNAM);
          _extraLen = data.readUInt16LE(Constants.CENEXT);
          _comLen = data.readUInt16LE(Constants.CENCOM);
          _diskStart = data.readUInt16LE(Constants.CENDSK);
          _inattr = data.readUInt16LE(Constants.CENATT);
          _attr = data.readUInt32LE(Constants.CENATX);
          _offset = data.readUInt32LE(Constants.CENOFF);
        },
        localHeaderToBinary: function() {
          var data = Buffer.alloc(Constants.LOCHDR);
          data.writeUInt32LE(Constants.LOCSIG, 0);
          data.writeUInt16LE(_version, Constants.LOCVER);
          data.writeUInt16LE(_flags & ~Constants.FLG_DESC, Constants.LOCFLG);
          data.writeUInt16LE(_method, Constants.LOCHOW);
          data.writeUInt32LE(_time, Constants.LOCTIM);
          data.writeUInt32LE(_crc, Constants.LOCCRC);
          data.writeUInt32LE(_compressedSize, Constants.LOCSIZ);
          data.writeUInt32LE(_size, Constants.LOCLEN);
          data.writeUInt16LE(_fnameLen, Constants.LOCNAM);
          data.writeUInt16LE(_localHeader.extraLen, Constants.LOCEXT);
          return data;
        },
        centralHeaderToBinary: function() {
          var data = Buffer.alloc(Constants.CENHDR + _fnameLen + _extraLen + _comLen);
          data.writeUInt32LE(Constants.CENSIG, 0);
          data.writeUInt16LE(_verMade, Constants.CENVEM);
          data.writeUInt16LE(_version, Constants.CENVER);
          data.writeUInt16LE(_flags & ~Constants.FLG_DESC, Constants.CENFLG);
          data.writeUInt16LE(_method, Constants.CENHOW);
          data.writeUInt32LE(_time, Constants.CENTIM);
          data.writeUInt32LE(_crc, Constants.CENCRC);
          data.writeUInt32LE(_compressedSize, Constants.CENSIZ);
          data.writeUInt32LE(_size, Constants.CENLEN);
          data.writeUInt16LE(_fnameLen, Constants.CENNAM);
          data.writeUInt16LE(_extraLen, Constants.CENEXT);
          data.writeUInt16LE(_comLen, Constants.CENCOM);
          data.writeUInt16LE(_diskStart, Constants.CENDSK);
          data.writeUInt16LE(_inattr, Constants.CENATT);
          data.writeUInt32LE(_attr, Constants.CENATX);
          data.writeUInt32LE(_offset, Constants.CENOFF);
          return data;
        },
        toJSON: function() {
          const bytes = function(nr) {
            return nr + " bytes";
          };
          return {
            made: _verMade,
            version: _version,
            flags: _flags,
            method: Utils.methodToString(_method),
            time: this.time,
            crc: "0x" + _crc.toString(16).toUpperCase(),
            compressedSize: bytes(_compressedSize),
            size: bytes(_size),
            fileNameLength: bytes(_fnameLen),
            extraLength: bytes(_extraLen),
            commentLength: bytes(_comLen),
            diskNumStart: _diskStart,
            inAttr: _inattr,
            attr: _attr,
            offset: _offset,
            centralHeaderSize: bytes(Constants.CENHDR + _fnameLen + _extraLen + _comLen)
          };
        },
        toString: function() {
          return JSON.stringify(this.toJSON(), null, "	");
        }
      };
    };
  }
});

// node_modules/adm-zip/headers/mainHeader.js
var require_mainHeader = __commonJS({
  "node_modules/adm-zip/headers/mainHeader.js"(exports, module2) {
    var Utils = require_util();
    var Constants = Utils.Constants;
    module2.exports = function() {
      var _volumeEntries = 0, _totalEntries = 0, _size = 0, _offset = 0, _commentLength = 0;
      const needsZip64 = () => _volumeEntries > Constants.EF_ZIP64_OR_16 || _totalEntries > Constants.EF_ZIP64_OR_16 || _size > Constants.EF_ZIP64_OR_32 || _offset > Constants.EF_ZIP64_OR_32;
      return {
        get diskEntries() {
          return _volumeEntries;
        },
        set diskEntries(val) {
          _volumeEntries = _totalEntries = val;
        },
        get totalEntries() {
          return _totalEntries;
        },
        set totalEntries(val) {
          _totalEntries = _volumeEntries = val;
        },
        get size() {
          return _size;
        },
        set size(val) {
          _size = val;
        },
        get offset() {
          return _offset;
        },
        set offset(val) {
          _offset = val;
        },
        get commentLength() {
          return _commentLength;
        },
        set commentLength(val) {
          _commentLength = val;
        },
        get mainHeaderSize() {
          return (needsZip64() ? Constants.ZIP64HDR + Constants.END64HDR : 0) + Constants.ENDHDR + _commentLength;
        },
        loadFromBinary: function(data) {
          if ((data.length !== Constants.ENDHDR || data.readUInt32LE(0) !== Constants.ENDSIG) && (data.length < Constants.ZIP64HDR || data.readUInt32LE(0) !== Constants.ZIP64SIG)) {
            throw Utils.Errors.INVALID_END();
          }
          if (data.readUInt32LE(0) === Constants.ENDSIG) {
            _volumeEntries = data.readUInt16LE(Constants.ENDSUB);
            _totalEntries = data.readUInt16LE(Constants.ENDTOT);
            _size = data.readUInt32LE(Constants.ENDSIZ);
            _offset = data.readUInt32LE(Constants.ENDOFF);
            _commentLength = data.readUInt16LE(Constants.ENDCOM);
          } else {
            _volumeEntries = Utils.readBigUInt64LE(data, Constants.ZIP64SUB);
            _totalEntries = Utils.readBigUInt64LE(data, Constants.ZIP64TOT);
            _size = Utils.readBigUInt64LE(data, Constants.ZIP64SIZB);
            _offset = Utils.readBigUInt64LE(data, Constants.ZIP64OFF);
            _commentLength = 0;
          }
        },
        toBinary: function() {
          if (!needsZip64()) {
            var b = Buffer.alloc(Constants.ENDHDR + _commentLength);
            b.writeUInt32LE(Constants.ENDSIG, 0);
            b.writeUInt32LE(0, 4);
            b.writeUInt16LE(_volumeEntries, Constants.ENDSUB);
            b.writeUInt16LE(_totalEntries, Constants.ENDTOT);
            b.writeUInt32LE(_size, Constants.ENDSIZ);
            b.writeUInt32LE(_offset, Constants.ENDOFF);
            b.writeUInt16LE(_commentLength, Constants.ENDCOM);
            b.fill(" ", Constants.ENDHDR);
            return b;
          }
          var b = Buffer.alloc(this.mainHeaderSize);
          let offset = 0;
          b.writeUInt32LE(Constants.ZIP64SIG, offset);
          Utils.writeBigUInt64LE(b, Constants.ZIP64HDR - Constants.ZIP64LEAD, offset + Constants.ZIP64SIZE);
          b.writeUInt16LE(45, offset + Constants.ZIP64VEM);
          b.writeUInt16LE(45, offset + Constants.ZIP64VER);
          b.writeUInt32LE(0, offset + Constants.ZIP64DSK);
          b.writeUInt32LE(0, offset + Constants.ZIP64DSKDIR);
          Utils.writeBigUInt64LE(b, _volumeEntries, offset + Constants.ZIP64SUB);
          Utils.writeBigUInt64LE(b, _totalEntries, offset + Constants.ZIP64TOT);
          Utils.writeBigUInt64LE(b, _size, offset + Constants.ZIP64SIZB);
          Utils.writeBigUInt64LE(b, _offset, offset + Constants.ZIP64OFF);
          const zip64EndOffset = _offset + _size;
          offset += Constants.ZIP64HDR;
          b.writeUInt32LE(Constants.END64SIG, offset);
          b.writeUInt32LE(0, offset + Constants.END64START);
          Utils.writeBigUInt64LE(b, zip64EndOffset, offset + Constants.END64OFF);
          b.writeUInt32LE(1, offset + Constants.END64NUMDISKS);
          offset += Constants.END64HDR;
          b.writeUInt32LE(Constants.ENDSIG, offset);
          b.writeUInt32LE(0, offset + 4);
          b.writeUInt16LE(Math.min(_volumeEntries, Constants.EF_ZIP64_OR_16), offset + Constants.ENDSUB);
          b.writeUInt16LE(Math.min(_totalEntries, Constants.EF_ZIP64_OR_16), offset + Constants.ENDTOT);
          b.writeUInt32LE(Math.min(_size, Constants.EF_ZIP64_OR_32), offset + Constants.ENDSIZ);
          b.writeUInt32LE(Math.min(_offset, Constants.EF_ZIP64_OR_32), offset + Constants.ENDOFF);
          b.writeUInt16LE(_commentLength, offset + Constants.ENDCOM);
          b.fill(" ", offset + Constants.ENDHDR);
          return b;
        },
        toJSON: function() {
          const offset = function(nr, len) {
            let offs = nr.toString(16).toUpperCase();
            while (offs.length < len) offs = "0" + offs;
            return "0x" + offs;
          };
          return {
            diskEntries: _volumeEntries,
            totalEntries: _totalEntries,
            size: _size + " bytes",
            offset: offset(_offset, 4),
            commentLength: _commentLength
          };
        },
        toString: function() {
          return JSON.stringify(this.toJSON(), null, "	");
        }
      };
    };
  }
});

// node_modules/adm-zip/headers/index.js
var require_headers = __commonJS({
  "node_modules/adm-zip/headers/index.js"(exports) {
    exports.EntryHeader = require_entryHeader();
    exports.MainHeader = require_mainHeader();
  }
});

// node_modules/adm-zip/methods/deflater.js
var require_deflater = __commonJS({
  "node_modules/adm-zip/methods/deflater.js"(exports, module2) {
    module2.exports = function(inbuf) {
      var zlib = require("zlib");
      var opts = { chunkSize: (parseInt(inbuf.length / 1024) + 1) * 1024 };
      return {
        deflate: function() {
          return zlib.deflateRawSync(inbuf, opts);
        },
        deflateAsync: function(callback) {
          var tmp = zlib.createDeflateRaw(opts), parts = [], total = 0;
          tmp.on("data", function(data) {
            parts.push(data);
            total += data.length;
          });
          tmp.on("end", function() {
            var buf = Buffer.alloc(total), written = 0;
            buf.fill(0);
            for (var i = 0; i < parts.length; i++) {
              var part = parts[i];
              part.copy(buf, written);
              written += part.length;
            }
            callback && callback(buf);
          });
          tmp.end(inbuf);
        }
      };
    };
  }
});

// node_modules/adm-zip/methods/inflater.js
var require_inflater = __commonJS({
  "node_modules/adm-zip/methods/inflater.js"(exports, module2) {
    var version = +(process?.versions?.node ?? "").split(".")[0] || 0;
    module2.exports = function(inbuf, expectedLength) {
      var zlib = require("zlib");
      const option = version >= 15 && expectedLength > 0 ? { maxOutputLength: expectedLength } : {};
      return {
        inflate: function() {
          return zlib.inflateRawSync(inbuf, option);
        },
        inflateAsync: function(callback) {
          var tmp = zlib.createInflateRaw(option), parts = [], total = 0;
          tmp.on("data", function(data) {
            parts.push(data);
            total += data.length;
          });
          tmp.on("end", function() {
            var buf = Buffer.alloc(total), written = 0;
            buf.fill(0);
            for (var i = 0; i < parts.length; i++) {
              var part = parts[i];
              part.copy(buf, written);
              written += part.length;
            }
            callback && callback(buf);
          });
          tmp.end(inbuf);
        }
      };
    };
  }
});

// node_modules/adm-zip/methods/zipcrypto.js
var require_zipcrypto = __commonJS({
  "node_modules/adm-zip/methods/zipcrypto.js"(exports, module2) {
    "use strict";
    var { randomFillSync } = require("crypto");
    var Errors = require_errors();
    var crctable = new Uint32Array(256).map((t, crc) => {
      for (let j = 0; j < 8; j++) {
        if (0 !== (crc & 1)) {
          crc = crc >>> 1 ^ 3988292384;
        } else {
          crc >>>= 1;
        }
      }
      return crc >>> 0;
    });
    var uMul = (a, b) => Math.imul(a, b) >>> 0;
    var crc32update = (pCrc32, bval) => {
      return crctable[(pCrc32 ^ bval) & 255] ^ pCrc32 >>> 8;
    };
    var genSalt = () => {
      if ("function" === typeof randomFillSync) {
        return randomFillSync(Buffer.alloc(12));
      } else {
        return genSalt.node();
      }
    };
    genSalt.node = () => {
      const salt = Buffer.alloc(12);
      const len = salt.length;
      for (let i = 0; i < len; i++) salt[i] = Math.random() * 256 & 255;
      return salt;
    };
    var config = {
      genSalt
    };
    function Initkeys(pw) {
      const pass = Buffer.isBuffer(pw) ? pw : Buffer.from(pw);
      this.keys = new Uint32Array([305419896, 591751049, 878082192]);
      for (let i = 0; i < pass.length; i++) {
        this.updateKeys(pass[i]);
      }
    }
    Initkeys.prototype.updateKeys = function(byteValue) {
      const keys = this.keys;
      keys[0] = crc32update(keys[0], byteValue);
      keys[1] += keys[0] & 255;
      keys[1] = uMul(keys[1], 134775813) + 1;
      keys[2] = crc32update(keys[2], keys[1] >>> 24);
      return byteValue;
    };
    Initkeys.prototype.next = function() {
      const k = (this.keys[2] | 2) >>> 0;
      return uMul(k, k ^ 1) >> 8 & 255;
    };
    function make_decrypter(pwd) {
      const keys = new Initkeys(pwd);
      return function(data) {
        const result = Buffer.alloc(data.length);
        let pos = 0;
        for (let c of data) {
          result[pos++] = keys.updateKeys(c ^ keys.next());
        }
        return result;
      };
    }
    function make_encrypter(pwd) {
      const keys = new Initkeys(pwd);
      return function(data, result, pos = 0) {
        if (!result) result = Buffer.alloc(data.length);
        for (let c of data) {
          const k = keys.next();
          result[pos++] = c ^ k;
          keys.updateKeys(c);
        }
        return result;
      };
    }
    function decrypt(data, header, pwd) {
      if (!data || !Buffer.isBuffer(data) || data.length < 12) {
        return Buffer.alloc(0);
      }
      const decrypter = make_decrypter(pwd);
      const salt = decrypter(data.slice(0, 12));
      const verifyByte = (header.flags & 8) === 8 ? header.timeHighByte : header.crc >>> 24;
      if (salt[11] !== verifyByte) {
        throw Errors.WRONG_PASSWORD();
      }
      return decrypter(data.slice(12));
    }
    function _salter(data) {
      if (Buffer.isBuffer(data) && data.length >= 12) {
        config.genSalt = function() {
          return data.slice(0, 12);
        };
      } else if (data === "node") {
        config.genSalt = genSalt.node;
      } else {
        config.genSalt = genSalt;
      }
    }
    function encrypt(data, header, pwd, oldlike = false) {
      if (data == null) data = Buffer.alloc(0);
      if (!Buffer.isBuffer(data)) data = Buffer.from(data.toString());
      const encrypter = make_encrypter(pwd);
      const salt = config.genSalt();
      salt[11] = header.crc >>> 24 & 255;
      if (oldlike) salt[10] = header.crc >>> 16 & 255;
      const result = Buffer.alloc(data.length + 12);
      encrypter(salt, result);
      return encrypter(data, result, 12);
    }
    module2.exports = { decrypt, encrypt, _salter };
  }
});

// node_modules/adm-zip/methods/index.js
var require_methods = __commonJS({
  "node_modules/adm-zip/methods/index.js"(exports) {
    exports.Deflater = require_deflater();
    exports.Inflater = require_inflater();
    exports.ZipCrypto = require_zipcrypto();
  }
});

// node_modules/adm-zip/zipEntry.js
var require_zipEntry = __commonJS({
  "node_modules/adm-zip/zipEntry.js"(exports, module2) {
    var Utils = require_util();
    var Headers = require_headers();
    var Constants = Utils.Constants;
    var Methods = require_methods();
    module2.exports = function(options, input) {
      var _centralHeader = new Headers.EntryHeader(), _entryName = Buffer.alloc(0), _comment = Buffer.alloc(0), _isDirectory = false, uncompressedData = null, _extra = Buffer.alloc(0), _extralocal = Buffer.alloc(0), _efs = true;
      const opts = options;
      const decoder = typeof opts.decoder === "object" ? opts.decoder : Utils.decoder;
      _efs = decoder.hasOwnProperty("efs") ? decoder.efs : false;
      function getCompressedDataFromZip() {
        if (!input || !(input instanceof Uint8Array)) {
          return Buffer.alloc(0);
        }
        _extralocal = _centralHeader.loadLocalHeaderFromBinary(input);
        return input.slice(_centralHeader.realDataOffset, _centralHeader.realDataOffset + _centralHeader.compressedSize);
      }
      function crc32OK(data) {
        if (!_centralHeader.flags_desc && !_centralHeader.localHeader.flags_desc) {
          if (Utils.crc32(data) !== _centralHeader.localHeader.crc) {
            return false;
          }
        } else {
          const descriptor = {};
          const dataEndOffset = _centralHeader.realDataOffset + _centralHeader.compressedSize;
          if (input.readUInt32LE(dataEndOffset) == Constants.LOCSIG || input.readUInt32LE(dataEndOffset) == Constants.CENSIG) {
            throw Utils.Errors.DESCRIPTOR_NOT_EXIST();
          }
          if (input.readUInt32LE(dataEndOffset) == Constants.EXTSIG) {
            descriptor.crc = input.readUInt32LE(dataEndOffset + Constants.EXTCRC);
            descriptor.compressedSize = input.readUInt32LE(dataEndOffset + Constants.EXTSIZ);
            descriptor.size = input.readUInt32LE(dataEndOffset + Constants.EXTLEN);
          } else if (input.readUInt16LE(dataEndOffset + 12) === 19280) {
            descriptor.crc = input.readUInt32LE(dataEndOffset + Constants.EXTCRC - 4);
            descriptor.compressedSize = input.readUInt32LE(dataEndOffset + Constants.EXTSIZ - 4);
            descriptor.size = input.readUInt32LE(dataEndOffset + Constants.EXTLEN - 4);
          } else {
            throw Utils.Errors.DESCRIPTOR_UNKNOWN();
          }
          if (descriptor.compressedSize !== _centralHeader.compressedSize || descriptor.size !== _centralHeader.size || descriptor.crc !== _centralHeader.crc) {
            throw Utils.Errors.DESCRIPTOR_FAULTY();
          }
          if (Utils.crc32(data) !== descriptor.crc) {
            return false;
          }
        }
        return true;
      }
      function decompress(async, callback, pass) {
        if (typeof callback === "undefined" && typeof async === "string") {
          pass = async;
          async = void 0;
        }
        if (_isDirectory) {
          if (async && callback) {
            callback(Buffer.alloc(0), Utils.Errors.DIRECTORY_CONTENT_ERROR());
          }
          return Buffer.alloc(0);
        }
        var compressedData = getCompressedDataFromZip();
        if (compressedData.length === 0) {
          if (async && callback) callback(compressedData);
          return compressedData;
        }
        if (_centralHeader.encrypted) {
          if ("string" !== typeof pass && !Buffer.isBuffer(pass)) {
            throw Utils.Errors.INVALID_PASS_PARAM();
          }
          compressedData = Methods.ZipCrypto.decrypt(compressedData, _centralHeader, pass);
        }
        var data = Buffer.alloc(_centralHeader.size);
        switch (_centralHeader.method) {
          case Utils.Constants.STORED:
            compressedData.copy(data);
            if (!crc32OK(data)) {
              if (async && callback) callback(data, Utils.Errors.BAD_CRC());
              throw Utils.Errors.BAD_CRC();
            } else {
              if (async && callback) callback(data);
              return data;
            }
          case Utils.Constants.DEFLATED:
            var inflater = new Methods.Inflater(compressedData, _centralHeader.size);
            if (!async) {
              const result = inflater.inflate(data);
              result.copy(data, 0);
              if (!crc32OK(data)) {
                throw Utils.Errors.BAD_CRC(`"${decoder.decode(_entryName)}"`);
              }
              return data;
            } else {
              inflater.inflateAsync(function(result) {
                result.copy(result, 0);
                if (callback) {
                  if (!crc32OK(result)) {
                    callback(result, Utils.Errors.BAD_CRC());
                  } else {
                    callback(result);
                  }
                }
              });
            }
            break;
          default:
            if (async && callback) callback(Buffer.alloc(0), Utils.Errors.UNKNOWN_METHOD());
            throw Utils.Errors.UNKNOWN_METHOD();
        }
      }
      function compress(async, callback) {
        if ((!uncompressedData || !uncompressedData.length) && Buffer.isBuffer(input)) {
          if (async && callback) callback(getCompressedDataFromZip());
          return getCompressedDataFromZip();
        }
        if (uncompressedData.length && !_isDirectory) {
          var compressedData;
          switch (_centralHeader.method) {
            case Utils.Constants.STORED:
              _centralHeader.compressedSize = _centralHeader.size;
              compressedData = Buffer.alloc(uncompressedData.length);
              uncompressedData.copy(compressedData);
              if (async && callback) callback(compressedData);
              return compressedData;
            default:
            case Utils.Constants.DEFLATED:
              var deflater = new Methods.Deflater(uncompressedData);
              if (!async) {
                var deflated = deflater.deflate();
                _centralHeader.compressedSize = deflated.length;
                return deflated;
              } else {
                deflater.deflateAsync(function(data) {
                  compressedData = Buffer.alloc(data.length);
                  _centralHeader.compressedSize = data.length;
                  data.copy(compressedData);
                  callback && callback(compressedData);
                });
              }
              deflater = null;
              break;
          }
        } else if (async && callback) {
          callback(Buffer.alloc(0));
        } else {
          return Buffer.alloc(0);
        }
      }
      function readUInt64LE(buffer, offset) {
        return Utils.readBigUInt64LE(buffer, offset);
      }
      function parseExtra(data) {
        try {
          var offset = 0;
          var signature, size, part;
          while (offset + 4 < data.length) {
            signature = data.readUInt16LE(offset);
            offset += 2;
            size = data.readUInt16LE(offset);
            offset += 2;
            part = data.slice(offset, offset + size);
            offset += size;
            if (Constants.ID_ZIP64 === signature) {
              parseZip64ExtendedInformation(part);
            }
          }
        } catch (error) {
          throw Utils.Errors.EXTRA_FIELD_PARSE_ERROR();
        }
      }
      function parseZip64ExtendedInformation(data) {
        var size, compressedSize, offset, diskNumStart;
        if (data.length >= Constants.EF_ZIP64_SCOMP) {
          size = readUInt64LE(data, Constants.EF_ZIP64_SUNCOMP);
          if (_centralHeader.size === Constants.EF_ZIP64_OR_32) {
            _centralHeader.size = size;
          }
        }
        if (data.length >= Constants.EF_ZIP64_RHO) {
          compressedSize = readUInt64LE(data, Constants.EF_ZIP64_SCOMP);
          if (_centralHeader.compressedSize === Constants.EF_ZIP64_OR_32) {
            _centralHeader.compressedSize = compressedSize;
          }
        }
        if (data.length >= Constants.EF_ZIP64_DSN) {
          offset = readUInt64LE(data, Constants.EF_ZIP64_RHO);
          if (_centralHeader.offset === Constants.EF_ZIP64_OR_32) {
            _centralHeader.offset = offset;
          }
        }
        if (data.length >= Constants.EF_ZIP64_DSN + 4) {
          diskNumStart = data.readUInt32LE(Constants.EF_ZIP64_DSN);
          if (_centralHeader.diskNumStart === Constants.EF_ZIP64_OR_16) {
            _centralHeader.diskNumStart = diskNumStart;
          }
        }
      }
      return {
        get entryName() {
          return decoder.decode(_entryName);
        },
        get rawEntryName() {
          return _entryName;
        },
        set entryName(val) {
          _entryName = Utils.toBuffer(val, decoder.encode);
          var lastChar = _entryName[_entryName.length - 1];
          _isDirectory = lastChar === 47 || lastChar === 92;
          _centralHeader.fileNameLength = _entryName.length;
        },
        get efs() {
          if (typeof _efs === "function") {
            return _efs(this.entryName);
          } else {
            return _efs;
          }
        },
        get extra() {
          return _extra;
        },
        set extra(val) {
          _extra = val;
          _centralHeader.extraLength = val.length;
          parseExtra(val);
        },
        get comment() {
          return decoder.decode(_comment);
        },
        set comment(val) {
          _comment = Utils.toBuffer(val, decoder.encode);
          _centralHeader.commentLength = _comment.length;
          if (_comment.length > 65535) throw Utils.Errors.COMMENT_TOO_LONG();
        },
        get name() {
          var n = decoder.decode(_entryName);
          return _isDirectory ? n.substr(n.length - 1).split("/").pop() : n.split("/").pop();
        },
        get isDirectory() {
          return _isDirectory;
        },
        getCompressedData: function() {
          return compress(false, null);
        },
        getCompressedDataAsync: function(callback) {
          compress(true, callback);
        },
        setData: function(value) {
          uncompressedData = Utils.toBuffer(value, Utils.decoder.encode);
          if (!_isDirectory && uncompressedData.length) {
            _centralHeader.size = uncompressedData.length;
            _centralHeader.method = Utils.Constants.DEFLATED;
            _centralHeader.crc = Utils.crc32(value);
            _centralHeader.changed = true;
          } else {
            _centralHeader.method = Utils.Constants.STORED;
          }
        },
        getData: function(pass) {
          if (_centralHeader.changed) {
            return uncompressedData;
          } else {
            return decompress(false, null, pass);
          }
        },
        getDataAsync: function(callback, pass) {
          if (_centralHeader.changed) {
            callback(uncompressedData);
          } else {
            decompress(true, callback, pass);
          }
        },
        set attr(attr) {
          _centralHeader.attr = attr;
        },
        get attr() {
          return _centralHeader.attr;
        },
        set header(data) {
          _centralHeader.loadFromBinary(data);
        },
        get header() {
          return _centralHeader;
        },
        packCentralHeader: function() {
          _centralHeader.flags_efs = this.efs;
          _centralHeader.extraLength = _extra.length;
          var header = _centralHeader.centralHeaderToBinary();
          var addpos = Utils.Constants.CENHDR;
          _entryName.copy(header, addpos);
          addpos += _entryName.length;
          _extra.copy(header, addpos);
          addpos += _centralHeader.extraLength;
          _comment.copy(header, addpos);
          return header;
        },
        packLocalHeader: function() {
          let addpos = 0;
          _centralHeader.flags_efs = this.efs;
          _centralHeader.extraLocalLength = _extralocal.length;
          const localHeaderBuf = _centralHeader.localHeaderToBinary();
          const localHeader = Buffer.alloc(localHeaderBuf.length + _entryName.length + _centralHeader.extraLocalLength);
          localHeaderBuf.copy(localHeader, addpos);
          addpos += localHeaderBuf.length;
          _entryName.copy(localHeader, addpos);
          addpos += _entryName.length;
          _extralocal.copy(localHeader, addpos);
          addpos += _extralocal.length;
          return localHeader;
        },
        toJSON: function() {
          const bytes = function(nr) {
            return "<" + (nr && nr.length + " bytes buffer" || "null") + ">";
          };
          return {
            entryName: this.entryName,
            name: this.name,
            comment: this.comment,
            isDirectory: this.isDirectory,
            header: _centralHeader.toJSON(),
            compressedData: bytes(input),
            data: bytes(uncompressedData)
          };
        },
        toString: function() {
          return JSON.stringify(this.toJSON(), null, "	");
        }
      };
    };
  }
});

// node_modules/adm-zip/zipFile.js
var require_zipFile = __commonJS({
  "node_modules/adm-zip/zipFile.js"(exports, module2) {
    var ZipEntry = require_zipEntry();
    var Headers = require_headers();
    var Utils = require_util();
    module2.exports = function(inBuffer, options) {
      var entryList = [], entryTable = {}, _comment = Buffer.alloc(0), mainHeader = new Headers.MainHeader(), loadedEntries = false;
      var password = null;
      const temporary = /* @__PURE__ */ new Set();
      const opts = options;
      const { noSort, decoder } = opts;
      if (inBuffer) {
        readMainHeader(opts.readEntries);
      } else {
        loadedEntries = true;
      }
      function makeTemporaryFolders() {
        const foldersList = /* @__PURE__ */ new Set();
        for (const elem of Object.keys(entryTable)) {
          const elements = elem.split("/");
          elements.pop();
          if (!elements.length) continue;
          for (let i = 0; i < elements.length; i++) {
            const sub = elements.slice(0, i + 1).join("/") + "/";
            foldersList.add(sub);
          }
        }
        for (const elem of foldersList) {
          if (!(elem in entryTable)) {
            const tempfolder = new ZipEntry(opts);
            tempfolder.entryName = elem;
            tempfolder.attr = 16;
            tempfolder.temporary = true;
            entryList.push(tempfolder);
            entryTable[tempfolder.entryName] = tempfolder;
            temporary.add(tempfolder);
          }
        }
      }
      function readEntries() {
        loadedEntries = true;
        entryTable = {};
        if (mainHeader.diskEntries > (inBuffer.length - mainHeader.offset) / Utils.Constants.CENHDR) {
          throw Utils.Errors.DISK_ENTRY_TOO_LARGE();
        }
        entryList = new Array(mainHeader.diskEntries);
        var index = mainHeader.offset;
        for (var i = 0; i < entryList.length; i++) {
          var tmp = index, entry = new ZipEntry(opts, inBuffer);
          entry.header = inBuffer.slice(tmp, tmp += Utils.Constants.CENHDR);
          entry.entryName = inBuffer.slice(tmp, tmp += entry.header.fileNameLength);
          if (entry.header.extraLength) {
            entry.extra = inBuffer.slice(tmp, tmp += entry.header.extraLength);
          }
          if (entry.header.commentLength) entry.comment = inBuffer.slice(tmp, tmp + entry.header.commentLength);
          index += entry.header.centralHeaderSize;
          entryList[i] = entry;
          entryTable[entry.entryName] = entry;
        }
        temporary.clear();
        makeTemporaryFolders();
      }
      function readMainHeader(readNow) {
        var i = inBuffer.length - Utils.Constants.ENDHDR, max = Math.max(0, i - 65535), n = max, endStart = inBuffer.length, endOffset = -1, commentEnd = 0;
        const trailingSpace = typeof opts.trailingSpace === "boolean" ? opts.trailingSpace : false;
        if (trailingSpace) max = 0;
        for (i; i >= n; i--) {
          if (inBuffer[i] !== 80) continue;
          if (inBuffer.readUInt32LE(i) === Utils.Constants.ENDSIG) {
            endOffset = i;
            commentEnd = i;
            endStart = i + Utils.Constants.ENDHDR;
            n = i - Utils.Constants.END64HDR;
            continue;
          }
          if (inBuffer.readUInt32LE(i) === Utils.Constants.END64SIG) {
            n = max;
            continue;
          }
          if (inBuffer.readUInt32LE(i) === Utils.Constants.ZIP64SIG) {
            endOffset = i;
            endStart = i + Utils.readBigUInt64LE(inBuffer, i + Utils.Constants.ZIP64SIZE) + Utils.Constants.ZIP64LEAD;
            break;
          }
        }
        if (endOffset == -1) throw Utils.Errors.INVALID_FORMAT();
        mainHeader.loadFromBinary(inBuffer.slice(endOffset, endStart));
        if (mainHeader.commentLength) {
          _comment = inBuffer.slice(commentEnd + Utils.Constants.ENDHDR);
        }
        if (readNow) readEntries();
      }
      function sortEntries() {
        if (entryList.length > 1 && !noSort) {
          entryList.sort((a, b) => a.entryName.toLowerCase().localeCompare(b.entryName.toLowerCase()));
        }
      }
      return {
        /**
         * Returns an array of ZipEntry objects existent in the current opened archive
         * @return Array
         */
        get entries() {
          if (!loadedEntries) {
            readEntries();
          }
          return entryList.filter((e) => !temporary.has(e));
        },
        /**
         * Archive comment
         * @return {String}
         */
        get comment() {
          return decoder.decode(_comment);
        },
        set comment(val) {
          _comment = Utils.toBuffer(val, decoder.encode);
          mainHeader.commentLength = _comment.length;
        },
        getEntryCount: function() {
          if (!loadedEntries) {
            return mainHeader.diskEntries;
          }
          return entryList.length;
        },
        forEach: function(callback) {
          this.entries.forEach(callback);
        },
        /**
         * Returns a reference to the entry with the given name or null if entry is inexistent
         *
         * @param entryName
         * @return ZipEntry
         */
        getEntry: function(entryName) {
          if (!loadedEntries) {
            readEntries();
          }
          return entryTable[entryName] || null;
        },
        /**
         * Adds the given entry to the entry list
         *
         * @param entry
         */
        setEntry: function(entry) {
          if (!loadedEntries) {
            readEntries();
          }
          entryList.push(entry);
          entryTable[entry.entryName] = entry;
          mainHeader.totalEntries = entryList.length;
        },
        /**
         * Removes the file with the given name from the entry list.
         *
         * If the entry is a directory, then all nested files and directories will be removed
         * @param entryName
         * @returns {void}
         */
        deleteFile: function(entryName, withsubfolders = true) {
          if (!loadedEntries) {
            readEntries();
          }
          const entry = entryTable[entryName];
          const list = this.getEntryChildren(entry, withsubfolders).map((child) => child.entryName);
          list.forEach(this.deleteEntry);
        },
        /**
         * Removes the entry with the given name from the entry list.
         *
         * @param {string} entryName
         * @returns {void}
         */
        deleteEntry: function(entryName) {
          if (!loadedEntries) {
            readEntries();
          }
          const entry = entryTable[entryName];
          const index = entryList.indexOf(entry);
          if (index >= 0) {
            entryList.splice(index, 1);
            delete entryTable[entryName];
            mainHeader.totalEntries = entryList.length;
          }
        },
        /**
         *  Iterates and returns all nested files and directories of the given entry
         *
         * @param entry
         * @return Array
         */
        getEntryChildren: function(entry, subfolders = true) {
          if (!loadedEntries) {
            readEntries();
          }
          if (typeof entry === "object") {
            if (entry.isDirectory && subfolders) {
              const list = [];
              const name = entry.entryName;
              for (const zipEntry of entryList) {
                if (zipEntry.entryName.startsWith(name)) {
                  list.push(zipEntry);
                }
              }
              return list;
            } else {
              return [entry];
            }
          }
          return [];
        },
        /**
         *  How many child elements entry has
         *
         * @param {ZipEntry} entry
         * @return {integer}
         */
        getChildCount: function(entry) {
          if (entry && entry.isDirectory) {
            const list = this.getEntryChildren(entry);
            return list.includes(entry) ? list.length - 1 : list.length;
          }
          return 0;
        },
        /**
         * Returns the zip file
         *
         * @return Buffer
         */
        compressToBuffer: function() {
          if (!loadedEntries) {
            readEntries();
          }
          sortEntries();
          const dataBlock = [];
          const headerBlocks = [];
          let totalSize = 0;
          let dindex = 0;
          mainHeader.size = 0;
          mainHeader.offset = 0;
          let totalEntries = 0;
          for (const entry of this.entries) {
            const compressedData = entry.getCompressedData();
            entry.header.offset = dindex;
            const localHeader = entry.packLocalHeader();
            const dataLength = localHeader.length + compressedData.length;
            dindex += dataLength;
            dataBlock.push(localHeader);
            dataBlock.push(compressedData);
            const centralHeader = entry.packCentralHeader();
            headerBlocks.push(centralHeader);
            mainHeader.size += centralHeader.length;
            totalSize += dataLength + centralHeader.length;
            totalEntries++;
          }
          totalSize += mainHeader.mainHeaderSize;
          mainHeader.offset = dindex;
          mainHeader.totalEntries = totalEntries;
          dindex = 0;
          const outBuffer = Buffer.alloc(totalSize);
          for (const content of dataBlock) {
            content.copy(outBuffer, dindex);
            dindex += content.length;
          }
          for (const content of headerBlocks) {
            content.copy(outBuffer, dindex);
            dindex += content.length;
          }
          const mh = mainHeader.toBinary();
          if (_comment) {
            _comment.copy(mh, mh.length - _comment.length);
          }
          mh.copy(outBuffer, dindex);
          inBuffer = outBuffer;
          loadedEntries = false;
          return outBuffer;
        },
        toAsyncBuffer: function(onSuccess, onFail, onItemStart, onItemEnd) {
          try {
            if (!loadedEntries) {
              readEntries();
            }
            sortEntries();
            const dataBlock = [];
            const centralHeaders = [];
            let totalSize = 0;
            let dindex = 0;
            let totalEntries = 0;
            mainHeader.size = 0;
            mainHeader.offset = 0;
            const compress2Buffer = function(entryLists) {
              if (entryLists.length > 0) {
                const entry = entryLists.shift();
                const name = entry.entryName + entry.extra.toString();
                if (onItemStart) onItemStart(name);
                entry.getCompressedDataAsync(function(compressedData) {
                  if (onItemEnd) onItemEnd(name);
                  entry.header.offset = dindex;
                  const localHeader = entry.packLocalHeader();
                  const dataLength = localHeader.length + compressedData.length;
                  dindex += dataLength;
                  dataBlock.push(localHeader);
                  dataBlock.push(compressedData);
                  const centalHeader = entry.packCentralHeader();
                  centralHeaders.push(centalHeader);
                  mainHeader.size += centalHeader.length;
                  totalSize += dataLength + centalHeader.length;
                  totalEntries++;
                  compress2Buffer(entryLists);
                });
              } else {
                totalSize += mainHeader.mainHeaderSize;
                mainHeader.offset = dindex;
                mainHeader.totalEntries = totalEntries;
                dindex = 0;
                const outBuffer = Buffer.alloc(totalSize);
                dataBlock.forEach(function(content) {
                  content.copy(outBuffer, dindex);
                  dindex += content.length;
                });
                centralHeaders.forEach(function(content) {
                  content.copy(outBuffer, dindex);
                  dindex += content.length;
                });
                const mh = mainHeader.toBinary();
                if (_comment) {
                  _comment.copy(mh, mh.length - _comment.length);
                }
                mh.copy(outBuffer, dindex);
                inBuffer = outBuffer;
                loadedEntries = false;
                onSuccess(outBuffer);
              }
            };
            compress2Buffer(Array.from(this.entries));
          } catch (e) {
            onFail(e);
          }
        }
      };
    };
  }
});

// node_modules/adm-zip/adm-zip.js
var require_adm_zip = __commonJS({
  "node_modules/adm-zip/adm-zip.js"(exports, module2) {
    var Utils = require_util();
    var pth = require("path");
    var ZipEntry = require_zipEntry();
    var ZipFile = require_zipFile();
    var get_Bool = (...val) => Utils.findLast(val, (c) => typeof c === "boolean");
    var get_Str = (...val) => Utils.findLast(val, (c) => typeof c === "string");
    var get_Fun = (...val) => Utils.findLast(val, (c) => typeof c === "function");
    var defaultOptions = {
      // option "noSort" : if true it disables files sorting
      noSort: false,
      // read entries during load (initial loading may be slower)
      readEntries: false,
      // default method is none
      method: Utils.Constants.NONE,
      // file system
      fs: null
    };
    module2.exports = function(input, options) {
      let inBuffer = null;
      const opts = Object.assign(/* @__PURE__ */ Object.create(null), defaultOptions);
      if (input && "object" === typeof input) {
        if (!(input instanceof Uint8Array)) {
          Object.assign(opts, input);
          input = opts.input ? opts.input : void 0;
          if (opts.input) delete opts.input;
        }
        if (Buffer.isBuffer(input)) {
          inBuffer = input;
          opts.method = Utils.Constants.BUFFER;
          input = void 0;
        }
      }
      Object.assign(opts, options);
      const filetools = new Utils(opts);
      if (typeof opts.decoder !== "object" || typeof opts.decoder.encode !== "function" || typeof opts.decoder.decode !== "function") {
        opts.decoder = Utils.decoder;
      }
      if (input && "string" === typeof input) {
        if (filetools.fs.existsSync(input)) {
          opts.method = Utils.Constants.FILE;
          opts.filename = input;
          inBuffer = filetools.fs.readFileSync(input);
        } else {
          throw Utils.Errors.INVALID_FILENAME();
        }
      }
      const _zip = new ZipFile(inBuffer, opts);
      const { canonical, sanitize, zipnamefix } = Utils;
      function getEntry(entry) {
        if (entry && _zip) {
          var item;
          if (typeof entry === "string") item = _zip.getEntry(pth.posix.normalize(entry));
          if (typeof entry === "object" && typeof entry.entryName !== "undefined" && typeof entry.header !== "undefined") item = _zip.getEntry(entry.entryName);
          if (item) {
            return item;
          }
        }
        return null;
      }
      function fixPath(zipPath) {
        const { join: join5, normalize, sep } = pth.posix;
        return join5(pth.isAbsolute(zipPath) ? "/" : ".", normalize(sep + zipPath.split("\\").join(sep) + sep));
      }
      function filenameFilter(filterfn) {
        if (filterfn instanceof RegExp) {
          return /* @__PURE__ */ (function(rx) {
            return function(filename) {
              return rx.test(filename);
            };
          })(filterfn);
        } else if ("function" !== typeof filterfn) {
          return () => true;
        }
        return filterfn;
      }
      const relativePath = (local, entry) => {
        let lastChar = entry.slice(-1);
        lastChar = lastChar === filetools.sep ? filetools.sep : "";
        return pth.relative(local, entry) + lastChar;
      };
      return {
        /**
         * Extracts the given entry from the archive and returns the content as a Buffer object
         * @param {ZipEntry|string} entry ZipEntry object or String with the full path of the entry
         * @param {Buffer|string} [pass] - password
         * @return Buffer or Null in case of error
         */
        readFile: function(entry, pass) {
          var item = getEntry(entry);
          return item && item.getData(pass) || null;
        },
        /**
         * Returns how many child elements has on entry (directories) on files it is always 0
         * @param {ZipEntry|string} entry ZipEntry object or String with the full path of the entry
         * @returns {integer}
         */
        childCount: function(entry) {
          const item = getEntry(entry);
          if (item) {
            return _zip.getChildCount(item);
          }
        },
        /**
         * Asynchronous readFile
         * @param {ZipEntry|string} entry ZipEntry object or String with the full path of the entry
         * @param {callback} callback
         *
         * @return Buffer or Null in case of error
         */
        readFileAsync: function(entry, callback) {
          var item = getEntry(entry);
          if (item) {
            item.getDataAsync(callback);
          } else {
            callback(null, "getEntry failed for:" + entry);
          }
        },
        /**
         * Extracts the given entry from the archive and returns the content as plain text in the given encoding
         * @param {ZipEntry|string} entry - ZipEntry object or String with the full path of the entry
         * @param {string} encoding - Optional. If no encoding is specified utf8 is used
         *
         * @return String
         */
        readAsText: function(entry, encoding) {
          var item = getEntry(entry);
          if (item) {
            var data = item.getData();
            if (data && data.length) {
              return data.toString(encoding || "utf8");
            }
          }
          return "";
        },
        /**
         * Asynchronous readAsText
         * @param {ZipEntry|string} entry ZipEntry object or String with the full path of the entry
         * @param {callback} callback
         * @param {string} [encoding] - Optional. If no encoding is specified utf8 is used
         *
         * @return String
         */
        readAsTextAsync: function(entry, callback, encoding) {
          var item = getEntry(entry);
          if (item) {
            item.getDataAsync(function(data, err) {
              if (err) {
                callback(data, err);
                return;
              }
              if (data && data.length) {
                callback(data.toString(encoding || "utf8"));
              } else {
                callback("");
              }
            });
          } else {
            callback("");
          }
        },
        /**
         * Remove the entry from the file or the entry and all it's nested directories and files if the given entry is a directory
         *
         * @param {ZipEntry|string} entry
         * @param {boolean} withsubfolders
         * @returns {void}
         */
        deleteFile: function(entry, withsubfolders = true) {
          var item = getEntry(entry);
          if (item) {
            _zip.deleteFile(item.entryName, withsubfolders);
          }
        },
        /**
         * Remove the entry from the file or directory without affecting any nested entries
         *
         * @param {ZipEntry|string} entry
         * @returns {void}
         */
        deleteEntry: function(entry) {
          var item = getEntry(entry);
          if (item) {
            _zip.deleteEntry(item.entryName);
          }
        },
        /**
         * Adds a comment to the zip. The zip must be rewritten after adding the comment.
         *
         * @param {string} comment
         */
        addZipComment: function(comment) {
          _zip.comment = comment;
        },
        /**
         * Returns the zip comment
         *
         * @return String
         */
        getZipComment: function() {
          return _zip.comment || "";
        },
        /**
         * Adds a comment to a specified zipEntry. The zip must be rewritten after adding the comment
         * The comment cannot exceed 65535 characters in length
         *
         * @param {ZipEntry} entry
         * @param {string} comment
         */
        addZipEntryComment: function(entry, comment) {
          var item = getEntry(entry);
          if (item) {
            item.comment = comment;
          }
        },
        /**
         * Returns the comment of the specified entry
         *
         * @param {ZipEntry} entry
         * @return String
         */
        getZipEntryComment: function(entry) {
          var item = getEntry(entry);
          if (item) {
            return item.comment || "";
          }
          return "";
        },
        /**
         * Updates the content of an existing entry inside the archive. The zip must be rewritten after updating the content
         *
         * @param {ZipEntry} entry
         * @param {Buffer} content
         */
        updateFile: function(entry, content) {
          var item = getEntry(entry);
          if (item) {
            item.setData(content);
          }
        },
        /**
         * Adds a file from the disk to the archive
         *
         * @param {string} localPath File to add to zip
         * @param {string} [zipPath] Optional path inside the zip
         * @param {string} [zipName] Optional name for the file
         * @param {string} [comment] Optional file comment
         */
        addLocalFile: function(localPath, zipPath, zipName, comment) {
          if (filetools.fs.existsSync(localPath)) {
            zipPath = zipPath ? fixPath(zipPath) : "";
            const p = pth.win32.basename(pth.win32.normalize(localPath));
            zipPath += zipName ? zipName : p;
            const _attr = filetools.fs.statSync(localPath);
            const data = _attr.isFile() ? filetools.fs.readFileSync(localPath) : Buffer.alloc(0);
            if (_attr.isDirectory()) zipPath += filetools.sep;
            this.addFile(zipPath, data, comment, _attr);
          } else {
            throw Utils.Errors.FILE_NOT_FOUND(localPath);
          }
        },
        /**
         * Callback for showing if everything was done.
         *
         * @callback doneCallback
         * @param {Error} err - Error object
         * @param {boolean} done - was request fully completed
         */
        /**
         * Adds a file from the disk to the archive
         *
         * @param {(object|string)} options - options object, if it is string it us used as localPath.
         * @param {string} options.localPath - Local path to the file.
         * @param {string} [options.comment] - Optional file comment.
         * @param {string} [options.zipPath] - Optional path inside the zip
         * @param {string} [options.zipName] - Optional name for the file
         * @param {doneCallback} callback - The callback that handles the response.
         */
        addLocalFileAsync: function(options2, callback) {
          options2 = typeof options2 === "object" ? options2 : { localPath: options2 };
          const localPath = pth.resolve(options2.localPath);
          const { comment } = options2;
          let { zipPath, zipName } = options2;
          const self = this;
          filetools.fs.stat(localPath, function(err, stats) {
            if (err) return callback(err, false);
            zipPath = zipPath ? fixPath(zipPath) : "";
            const p = pth.win32.basename(pth.win32.normalize(localPath));
            zipPath += zipName ? zipName : p;
            if (stats.isFile()) {
              filetools.fs.readFile(localPath, function(err2, data) {
                if (err2) return callback(err2, false);
                self.addFile(zipPath, data, comment, stats);
                return setImmediate(callback, void 0, true);
              });
            } else if (stats.isDirectory()) {
              zipPath += filetools.sep;
              self.addFile(zipPath, Buffer.alloc(0), comment, stats);
              return setImmediate(callback, void 0, true);
            }
          });
        },
        /**
         * Adds a local directory and all its nested files and directories to the archive
         *
         * @param {string} localPath - local path to the folder
         * @param {string} [zipPath] - optional path inside zip
         * @param {(RegExp|function)} [filter] - optional RegExp or Function if files match will be included.
         */
        addLocalFolder: function(localPath, zipPath, filter) {
          filter = filenameFilter(filter);
          zipPath = zipPath ? fixPath(zipPath) : "";
          localPath = pth.normalize(localPath);
          if (filetools.fs.existsSync(localPath)) {
            const items = filetools.findFiles(localPath);
            const self = this;
            if (items.length) {
              for (const filepath of items) {
                const p = pth.join(zipPath, relativePath(localPath, filepath));
                if (filter(p)) {
                  self.addLocalFile(filepath, pth.dirname(p));
                }
              }
            }
          } else {
            throw Utils.Errors.FILE_NOT_FOUND(localPath);
          }
        },
        /**
         * Asynchronous addLocalFolder
         * @param {string} localPath
         * @param {callback} callback
         * @param {string} [zipPath] optional path inside zip
         * @param {RegExp|function} [filter] optional RegExp or Function if files match will
         *               be included.
         */
        addLocalFolderAsync: function(localPath, callback, zipPath, filter) {
          filter = filenameFilter(filter);
          zipPath = zipPath ? fixPath(zipPath) : "";
          localPath = pth.normalize(localPath);
          var self = this;
          filetools.fs.open(localPath, "r", function(err) {
            if (err && err.code === "ENOENT") {
              callback(void 0, Utils.Errors.FILE_NOT_FOUND(localPath));
            } else if (err) {
              callback(void 0, err);
            } else {
              var items = filetools.findFiles(localPath);
              var i = -1;
              var next = function() {
                i += 1;
                if (i < items.length) {
                  var filepath = items[i];
                  var p = relativePath(localPath, filepath).split("\\").join("/");
                  p = p.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "");
                  if (filter(p)) {
                    filetools.fs.stat(filepath, function(er0, stats) {
                      if (er0) callback(void 0, er0);
                      if (stats.isFile()) {
                        filetools.fs.readFile(filepath, function(er1, data) {
                          if (er1) {
                            callback(void 0, er1);
                          } else {
                            self.addFile(zipPath + p, data, "", stats);
                            next();
                          }
                        });
                      } else {
                        self.addFile(zipPath + p + "/", Buffer.alloc(0), "", stats);
                        next();
                      }
                    });
                  } else {
                    process.nextTick(() => {
                      next();
                    });
                  }
                } else {
                  callback(true, void 0);
                }
              };
              next();
            }
          });
        },
        /**
         * Adds a local directory and all its nested files and directories to the archive
         *
         * @param {object | string} options - options object, if it is string it us used as localPath.
         * @param {string} options.localPath - Local path to the folder.
         * @param {string} [options.zipPath] - optional path inside zip.
         * @param {RegExp|function} [options.filter] - optional RegExp or Function if files match will be included.
         * @param {function|string} [options.namefix] - optional function to help fix filename
         * @param {doneCallback} callback - The callback that handles the response.
         *
         */
        addLocalFolderAsync2: function(options2, callback) {
          const self = this;
          options2 = typeof options2 === "object" ? options2 : { localPath: options2 };
          const localPath = pth.resolve(fixPath(options2.localPath));
          let { zipPath, filter, namefix } = options2;
          if (filter instanceof RegExp) {
            filter = /* @__PURE__ */ (function(rx) {
              return function(filename) {
                return rx.test(filename);
              };
            })(filter);
          } else if ("function" !== typeof filter) {
            filter = function() {
              return true;
            };
          }
          zipPath = zipPath ? fixPath(zipPath) : "";
          if (namefix === "latin1") {
            namefix = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "");
          }
          if (typeof namefix !== "function") namefix = (str) => str;
          const relPathFix = (entry) => pth.join(zipPath, namefix(relativePath(localPath, entry)));
          const fileNameFix = (entry) => pth.win32.basename(pth.win32.normalize(namefix(entry)));
          filetools.fs.open(localPath, "r", function(err) {
            if (err && err.code === "ENOENT") {
              callback(void 0, Utils.Errors.FILE_NOT_FOUND(localPath));
            } else if (err) {
              callback(void 0, err);
            } else {
              filetools.findFilesAsync(localPath, function(err2, fileEntries) {
                if (err2) return callback(err2);
                fileEntries = fileEntries.filter((dir) => filter(relPathFix(dir)));
                if (!fileEntries.length) callback(void 0, false);
                setImmediate(
                  fileEntries.reverse().reduce(function(next, entry) {
                    return function(err3, done) {
                      if (err3 || done === false) return setImmediate(next, err3, false);
                      self.addLocalFileAsync(
                        {
                          localPath: entry,
                          zipPath: pth.dirname(relPathFix(entry)),
                          zipName: fileNameFix(entry)
                        },
                        next
                      );
                    };
                  }, callback)
                );
              });
            }
          });
        },
        /**
         * Adds a local directory and all its nested files and directories to the archive
         *
         * @param {string} localPath - path where files will be extracted
         * @param {object} props - optional properties
         * @param {string} [props.zipPath] - optional path inside zip
         * @param {RegExp|function} [props.filter] - optional RegExp or Function if files match will be included.
         * @param {function|string} [props.namefix] - optional function to help fix filename
         */
        addLocalFolderPromise: function(localPath, props) {
          return new Promise((resolve3, reject) => {
            this.addLocalFolderAsync2(Object.assign({ localPath }, props), (err, done) => {
              if (err) reject(err);
              if (done) resolve3(this);
            });
          });
        },
        /**
         * Allows you to create a entry (file or directory) in the zip file.
         * If you want to create a directory the entryName must end in / and a null buffer should be provided.
         * Comment and attributes are optional
         *
         * @param {string} entryName
         * @param {Buffer | string} content - file content as buffer or utf8 coded string
         * @param {string} [comment] - file comment
         * @param {number | object} [attr] - number as unix file permissions, object as filesystem Stats object
         */
        addFile: function(entryName, content, comment, attr) {
          entryName = zipnamefix(entryName);
          let entry = getEntry(entryName);
          const update = entry != null;
          if (!update) {
            entry = new ZipEntry(opts);
            entry.entryName = entryName;
          }
          entry.comment = comment || "";
          const isStat = "object" === typeof attr && attr instanceof filetools.fs.Stats;
          if (isStat) {
            entry.header.time = attr.mtime;
          }
          var fileattr = entry.isDirectory ? 16 : 0;
          let unix = entry.isDirectory ? 16384 : 32768;
          if (isStat) {
            unix |= 4095 & attr.mode;
          } else if ("number" === typeof attr) {
            unix |= 4095 & attr;
          } else {
            unix |= entry.isDirectory ? 493 : 420;
          }
          fileattr = (fileattr | unix << 16) >>> 0;
          entry.attr = fileattr;
          entry.setData(content);
          if (!update) _zip.setEntry(entry);
          return entry;
        },
        /**
         * Returns an array of ZipEntry objects representing the files and folders inside the archive
         *
         * @param {string} [password]
         * @returns Array
         */
        getEntries: function(password) {
          _zip.password = password;
          return _zip ? _zip.entries : [];
        },
        /**
         * Returns a ZipEntry object representing the file or folder specified by ``name``.
         *
         * @param {string} name
         * @return ZipEntry
         */
        getEntry: function(name) {
          return getEntry(name);
        },
        getEntryCount: function() {
          return _zip.getEntryCount();
        },
        forEach: function(callback) {
          return _zip.forEach(callback);
        },
        /**
         * Extracts the given entry to the given targetPath
         * If the entry is a directory inside the archive, the entire directory and it's subdirectories will be extracted
         *
         * @param {string|ZipEntry} entry - ZipEntry object or String with the full path of the entry
         * @param {string} targetPath - Target folder where to write the file
         * @param {boolean} [maintainEntryPath=true] - If maintainEntryPath is true and the entry is inside a folder, the entry folder will be created in targetPath as well. Default is TRUE
         * @param {boolean} [overwrite=false] - If the file already exists at the target path, the file will be overwriten if this is true.
         * @param {boolean} [keepOriginalPermission=false] - The file will be set as the permission from the entry if this is true.
         * @param {string} [outFileName] - String If set will override the filename of the extracted file (Only works if the entry is a file)
         *
         * @return Boolean
         */
        extractEntryTo: function(entry, targetPath, maintainEntryPath, overwrite, keepOriginalPermission, outFileName) {
          overwrite = get_Bool(false, overwrite);
          keepOriginalPermission = get_Bool(false, keepOriginalPermission);
          maintainEntryPath = get_Bool(true, maintainEntryPath);
          outFileName = get_Str(keepOriginalPermission, outFileName);
          var item = getEntry(entry);
          if (!item) {
            throw Utils.Errors.NO_ENTRY();
          }
          var entryName = canonical(item.entryName);
          var target = sanitize(targetPath, outFileName && !item.isDirectory ? canonical(outFileName) : maintainEntryPath ? entryName : pth.basename(entryName));
          if (item.isDirectory) {
            var children = _zip.getEntryChildren(item);
            children.forEach(function(child) {
              if (child.isDirectory) return;
              var content2 = child.getData();
              if (!content2) {
                throw Utils.Errors.CANT_EXTRACT_FILE();
              }
              var name = canonical(child.entryName);
              var childName = sanitize(targetPath, maintainEntryPath ? name : pth.basename(name));
              const fileAttr2 = keepOriginalPermission ? child.header.fileAttr : void 0;
              filetools.writeFileTo(childName, content2, overwrite, fileAttr2);
            });
            return true;
          }
          var content = item.getData(_zip.password);
          if (!content) throw Utils.Errors.CANT_EXTRACT_FILE();
          if (filetools.fs.existsSync(target) && !overwrite) {
            throw Utils.Errors.CANT_OVERRIDE();
          }
          const fileAttr = keepOriginalPermission ? entry.header.fileAttr : void 0;
          filetools.writeFileTo(target, content, overwrite, fileAttr);
          return true;
        },
        /**
         * Test the archive
         * @param {string} [pass]
         */
        test: function(pass) {
          if (!_zip) {
            return false;
          }
          for (var entry of _zip.entries) {
            try {
              if (entry.isDirectory) {
                continue;
              }
              var content = _zip.entries[entry].getData(pass);
              if (!content) {
                return false;
              }
            } catch (err) {
              return false;
            }
          }
          return true;
        },
        /**
         * Extracts the entire archive to the given location
         *
         * @param {string} targetPath Target location
         * @param {boolean} [overwrite=false] If the file already exists at the target path, the file will be overwriten if this is true.
         *                  Default is FALSE
         * @param {boolean} [keepOriginalPermission=false] The file will be set as the permission from the entry if this is true.
         *                  Default is FALSE
         * @param {string|Buffer} [pass] password
         */
        extractAllTo: function(targetPath, overwrite, keepOriginalPermission, pass) {
          keepOriginalPermission = get_Bool(false, keepOriginalPermission);
          pass = get_Str(keepOriginalPermission, pass);
          overwrite = get_Bool(false, overwrite);
          if (!_zip) throw Utils.Errors.NO_ZIP();
          _zip.entries.forEach(function(entry) {
            var entryName = sanitize(targetPath, canonical(entry.entryName));
            if (entry.isDirectory) {
              filetools.makeDir(entryName);
              return;
            }
            var content = entry.getData(pass);
            if (!content) {
              throw Utils.Errors.CANT_EXTRACT_FILE();
            }
            const fileAttr = keepOriginalPermission ? entry.header.fileAttr : void 0;
            filetools.writeFileTo(entryName, content, overwrite, fileAttr);
            try {
              filetools.fs.utimesSync(entryName, entry.header.time, entry.header.time);
            } catch (err) {
              throw Utils.Errors.CANT_EXTRACT_FILE();
            }
          });
        },
        /**
         * Asynchronous extractAllTo
         *
         * @param {string} targetPath Target location
         * @param {boolean} [overwrite=false] If the file already exists at the target path, the file will be overwriten if this is true.
         *                  Default is FALSE
         * @param {boolean} [keepOriginalPermission=false] The file will be set as the permission from the entry if this is true.
         *                  Default is FALSE
         * @param {function} callback The callback will be executed when all entries are extracted successfully or any error is thrown.
         */
        extractAllToAsync: function(targetPath, overwrite, keepOriginalPermission, callback) {
          callback = get_Fun(overwrite, keepOriginalPermission, callback);
          keepOriginalPermission = get_Bool(false, keepOriginalPermission);
          overwrite = get_Bool(false, overwrite);
          if (!callback) {
            return new Promise((resolve3, reject) => {
              this.extractAllToAsync(targetPath, overwrite, keepOriginalPermission, function(err) {
                if (err) {
                  reject(err);
                } else {
                  resolve3(this);
                }
              });
            });
          }
          if (!_zip) {
            callback(Utils.Errors.NO_ZIP());
            return;
          }
          targetPath = pth.resolve(targetPath);
          const getPath = (entry) => sanitize(targetPath, pth.normalize(canonical(entry.entryName)));
          const getError = (msg, file) => new Error(msg + ': "' + file + '"');
          const dirEntries = [];
          const fileEntries = [];
          _zip.entries.forEach((e) => {
            if (e.isDirectory) {
              dirEntries.push(e);
            } else {
              fileEntries.push(e);
            }
          });
          for (const entry of dirEntries) {
            const dirPath = getPath(entry);
            const dirAttr = keepOriginalPermission ? entry.header.fileAttr : void 0;
            try {
              filetools.makeDir(dirPath);
              if (dirAttr) filetools.fs.chmodSync(dirPath, dirAttr);
              filetools.fs.utimesSync(dirPath, entry.header.time, entry.header.time);
            } catch (er) {
              callback(getError("Unable to create folder", dirPath));
            }
          }
          fileEntries.reverse().reduce(function(next, entry) {
            return function(err) {
              if (err) {
                next(err);
              } else {
                const entryName = pth.normalize(canonical(entry.entryName));
                const filePath = sanitize(targetPath, entryName);
                entry.getDataAsync(function(content, err_1) {
                  if (err_1) {
                    next(err_1);
                  } else if (!content) {
                    next(Utils.Errors.CANT_EXTRACT_FILE());
                  } else {
                    const fileAttr = keepOriginalPermission ? entry.header.fileAttr : void 0;
                    filetools.writeFileToAsync(filePath, content, overwrite, fileAttr, function(succ) {
                      if (!succ) {
                        next(getError("Unable to write file", filePath));
                      }
                      filetools.fs.utimes(filePath, entry.header.time, entry.header.time, function(err_2) {
                        if (err_2) {
                          next(getError("Unable to set times", filePath));
                        } else {
                          next();
                        }
                      });
                    });
                  }
                });
              }
            };
          }, callback)();
        },
        /**
         * Writes the newly created zip file to disk at the specified location or if a zip was opened and no ``targetFileName`` is provided, it will overwrite the opened zip
         *
         * @param {string} targetFileName
         * @param {function} callback
         */
        writeZip: function(targetFileName, callback) {
          if (arguments.length === 1) {
            if (typeof targetFileName === "function") {
              callback = targetFileName;
              targetFileName = "";
            }
          }
          if (!targetFileName && opts.filename) {
            targetFileName = opts.filename;
          }
          if (!targetFileName) return;
          var zipData = _zip.compressToBuffer();
          if (zipData) {
            var ok = filetools.writeFileTo(targetFileName, zipData, true);
            if (typeof callback === "function") callback(!ok ? new Error("failed") : null, "");
          }
        },
        /**
                 *
                 * @param {string} targetFileName
                 * @param {object} [props]
                 * @param {boolean} [props.overwrite=true] If the file already exists at the target path, the file will be overwriten if this is true.
                 * @param {boolean} [props.perm] The file will be set as the permission from the entry if this is true.
        
                 * @returns {Promise<void>}
                 */
        writeZipPromise: function(targetFileName, props) {
          const { overwrite, perm } = Object.assign({ overwrite: true }, props);
          return new Promise((resolve3, reject) => {
            if (!targetFileName && opts.filename) targetFileName = opts.filename;
            if (!targetFileName) reject("ADM-ZIP: ZIP File Name Missing");
            this.toBufferPromise().then((zipData) => {
              const ret = (done) => done ? resolve3(done) : reject("ADM-ZIP: Wasn't able to write zip file");
              filetools.writeFileToAsync(targetFileName, zipData, overwrite, perm, ret);
            }, reject);
          });
        },
        /**
         * @returns {Promise<Buffer>} A promise to the Buffer.
         */
        toBufferPromise: function() {
          return new Promise((resolve3, reject) => {
            _zip.toAsyncBuffer(resolve3, reject);
          });
        },
        /**
         * Returns the content of the entire zip file as a Buffer object
         *
         * @prop {function} [onSuccess]
         * @prop {function} [onFail]
         * @prop {function} [onItemStart]
         * @prop {function} [onItemEnd]
         * @returns {Buffer}
         */
        toBuffer: function(onSuccess, onFail, onItemStart, onItemEnd) {
          if (typeof onSuccess === "function") {
            _zip.toAsyncBuffer(onSuccess, onFail, onItemStart, onItemEnd);
            return null;
          }
          return _zip.compressToBuffer();
        }
      };
    };
  }
});

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => VaultSearchPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian7 = require("obsidian");
var path4 = __toESM(require("path"));

// src/agent-integration.ts
var import_promises = require("fs/promises");
var path = __toESM(require("path"));
var AGENTS_MARKER_START = "<!-- vault-search:start -->";
var AGENTS_MARKER_END = "<!-- vault-search:end -->";
var SKILL_MARKER = "<!-- vault-search:managed -->";
var AGENTS_FILE = "AGENTS.md";
var CLAUDE_FILE = "CLAUDE.md";
var WRAPPER_REL = "search.ps1";
var INSTRUCTION_FILES = [AGENTS_FILE, CLAUDE_FILE];
var SKILL_TARGETS = [
  [".claude", "skills", "vault-search", "SKILL.md"],
  [".agents", "skills", "vault-search", "SKILL.md"],
  [".opencode", "skills", "vault-search", "SKILL.md"]
];
var CONFLICT_RE = /(?:vault\s*[-_]?search|obsidian-vault-search|Vault Search|hybrid\s*search)/i;
var AGENTS_BLOCK = [
  AGENTS_MARKER_START,
  "## Vault Search",
  "",
  "This vault runs the **Vault Search Service** (hybrid lexical + semantic search).",
  "Use it as the default first tool for vault content searches.",
  "",
  "- Run the search wrapper from the vault root (it resolves the vault itself):",
  "  ```powershell",
  '  & .\\.obsidian\\plugins\\obsidian-vault-search\\search.ps1 -Top 40 -Json "<query>"',
  "  & .\\.obsidian\\plugins\\obsidian-vault-search\\search.ps1 -Status",
  "  ```",
  "- Treat results as candidates: read the full body of important files before concluding.",
  "- For broad/exhaustive/history requests, expand with additional searches using people, companies, projects, aliases, and related terms from the first pass.",
  "- If the exact target file is already known, read it directly instead of searching.",
  "- The plugin manages the index and service lifecycle; do not start a separate search daemon.",
  "- If `INDEX_REBUILD_REQUIRED` is returned, follow the reported recovery path (`rebuild-vectors` or `rebuild-all`).",
  "- Use `rg`/grep only to verify an exact known string or to debug search coverage \u2014 not as the normal search path.",
  AGENTS_MARKER_END
].join("\n");
var SEARCH_PS1 = `# Vault Search Service \u2014 agent wrapper.
# Managed by the Vault Search plugin; edits are overwritten on reinstall.
# The vault is derived from this script's own location (no hardcoded paths).
param(
    [Parameter(Position = 0)][string]$Query = "",
    [int]$Top = 40,
    [switch]$Json,
    [switch]$Status
)

$ErrorActionPreference = "Stop"
$Vault = (Resolve-Path (Join-Path $PSScriptRoot "..\\..\\..")).Path
$Canonical = [IO.Path]::GetFullPath($Vault).Replace('\\', '/').ToLowerInvariant()
$Sha = [Security.Cryptography.SHA256]::Create()
try { $Hash = ($Sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Canonical)) | ForEach-Object { $_.ToString('x2') }) -join '' }
finally { $Sha.Dispose() }
$DataDir = Join-Path $env:LOCALAPPDATA ("ObsidianVaultSearch\\vaults\\" + $Hash.Substring(0, 20))
$MachinePath = Join-Path $DataDir "machine.json"
if (-not (Test-Path $MachinePath)) { throw "Vault Search backend is not installed for this PC." }
$Machine = Get-Content -Raw -Encoding UTF8 $MachinePath | ConvertFrom-Json
$Python = $Machine.pythonExecutable
if (-not (Test-Path $Python)) {
    # The configured value may be a bare command (e.g. "python"); resolve it.
    $Resolved = Get-Command $Python -ErrorAction SilentlyContinue
    if ($Resolved -and $Resolved.Source) { $Python = $Resolved.Source }
    else { throw "Configured Python does not exist: $Python" }
}
$Backend = Join-Path $Vault ".obsidian\\plugins\\obsidian-vault-search\\backend"
if (-not (Test-Path $Python)) { throw "Configured Python does not exist: $Python" }
if (-not (Test-Path $Backend)) { throw "Vault Search plugin backend is not installed." }
$env:PYTHONUTF8 = "1"
$env:PYTHONPATH = $Backend
$Arguments = @("-X", "utf8", "-m", "vault_search.cli", "--vault", $Vault, "--timeout", "30")
if ($Status) {
    $Arguments += "status"
} else {
    if (-not $Query) { throw "Query is required unless -Status is used." }
    $Arguments += @("search", "--top", [string]$Top)
    if ($Json) { $Arguments += "--json" }
    $Arguments += $Query
}
& $Python @Arguments
exit $LASTEXITCODE
`;
var SKILL_MD = `---
name: vault-search
description: Default vault content search. Start every vault content search with the vault-search plugin, expand with follow-up queries, and read the source files of important results. Use rg/grep only to verify exact known strings or debug search coverage.
license: Proprietary
metadata:
  displayName: "vault-search"
---

${SKILL_MARKER}

# Vault Search

Search and investigate Obsidian vault content.

## Core rules

1. Start every vault content search with the \`vault-search\` plugin.
2. Search results are candidates. Read the full body of important files before concluding.
3. For broad or exhaustive requests, run additional \`vault-search\` queries using entities, aliases, and related terms found in the first pass.
4. \`rg\`/grep is not the default search step. Use it only to verify an exact known string that the plugin appears to have missed, or to diagnose search coverage.
5. If the exact target file is already known, read it directly instead of searching.
6. Never hardcode machine-specific absolute vault paths; derive paths from the vault root.

## Standard search

Run from the vault root (the wrapper resolves the vault itself):

\`\`\`powershell
# Basic search
& .\\.obsidian\\plugins\\obsidian-vault-search\\search.ps1 -Top 40 -Json "<query>"

# Service status
& .\\.obsidian\\plugins\\obsidian-vault-search\\search.ps1 -Status
\`\`\`

Use \`-Top 40\` as the default candidate size and read the source files of key results.

## Service behavior

- With Obsidian open: the plugin manages the vault's Python sidecar and model lifecycle.
- With Obsidian closed: \`search\` / \`rebuild-vectors\` / \`rebuild-all\` auto-start and attach a standalone sidecar using the machine configuration.
- The standalone unloads the model after 300s of model inactivity and exits after 1,800s of overall inactivity.
- If \`INDEX_REBUILD_REQUIRED\` is returned, follow the recovery path in the error message (\`rebuild-vectors\` or \`rebuild-all\`).

## \`rg\` exception usage

- Verify a known exact string that is missing from vault-search results.
- Re-check the existence of exact numbers, codes, or identifiers.
- Diagnose indexing/coverage problems.

Do not treat grep snippets alone as fact.
`;
function updateAgentsFile(existing, block = AGENTS_BLOCK) {
  const body = `${block}
`;
  if (existing === null) {
    return { status: "created", content: body };
  }
  const start = existing.indexOf(AGENTS_MARKER_START);
  const end = existing.indexOf(AGENTS_MARKER_END);
  if (start >= 0 && end > start) {
    const outside = existing.slice(0, start) + existing.slice(end + AGENTS_MARKER_END.length);
    if (CONFLICT_RE.test(outside)) {
      return { status: "conflict", content: null };
    }
    const after = existing.slice(end + AGENTS_MARKER_END.length).replace(/^[ \t]*\r?\n+/, "");
    const tail = after.trim().length > 0 ? `
${after}` : after;
    const next2 = existing.slice(0, start) + body + tail;
    return {
      status: next2 === existing ? "unchanged" : "updated",
      content: next2
    };
  }
  if (CONFLICT_RE.test(existing)) {
    return { status: "conflict", content: null };
  }
  const next = `${existing.replace(/\s*$/, "")}

${body}`;
  return { status: "updated", content: next };
}
async function readOptional(target) {
  try {
    return await (0, import_promises.readFile)(target, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}
async function readForStatus(target) {
  try {
    return await (0, import_promises.readFile)(target, "utf8");
  } catch {
    return null;
  }
}
async function writeIfChanged(target, content) {
  if (await readOptional(target) === content) return false;
  await (0, import_promises.mkdir)(path.dirname(target), { recursive: true });
  await (0, import_promises.writeFile)(target, content, "utf8");
  return true;
}
async function installSkill(skillPath) {
  const existing = await readOptional(skillPath);
  if (existing !== null && !existing.includes(SKILL_MARKER)) {
    return "skipped";
  }
  const changed = await writeIfChanged(skillPath, SKILL_MD);
  return changed ? "written" : "unchanged";
}
async function installSkills(vaultPath) {
  let anyWritten = false;
  let anySkipped = false;
  let anyTargets = 0;
  for (const rel of SKILL_TARGETS) {
    const result = await installSkill(path.join(vaultPath, ...rel));
    anyTargets += 1;
    if (result === "written") anyWritten = true;
    if (result === "skipped") anySkipped = true;
  }
  if (anyWritten) return "written";
  return anySkipped && anyTargets === SKILL_TARGETS.length ? "skipped" : "unchanged";
}
function agentIntegrationNotice(result) {
  const agents = result.agentsFile === "created" ? "AGENTS.md \uC0DD\uC131" : result.agentsFile === "updated" ? "AGENTS.md \uAC31\uC2E0" : result.agentsFile === "conflict" ? "AGENTS.md\uC5D0 \uAE30\uC874 \uAC80\uC0C9 \uC9C0\uC2DC\uAC00 \uC788\uC5B4 \uAC74\uB108\uB700" : "AGENTS.md \uB3D9\uC77C";
  const claude = result.claudeFile === "created" ? "CLAUDE.md \uC0DD\uC131" : result.claudeFile === "updated" ? "CLAUDE.md \uAC31\uC2E0" : result.claudeFile === "conflict" ? "CLAUDE.md\uC5D0 \uAE30\uC874 \uAC80\uC0C9 \uC9C0\uC2DC\uAC00 \uC788\uC5B4 \uAC74\uB108\uB700" : "CLAUDE.md \uB3D9\uC77C";
  const skill = result.skill === "written" ? "\uC2A4\uD0AC \uC124\uCE58" : result.skill === "skipped" ? "\uAE30\uC874 \uC2A4\uD0AC \uC720\uC9C0(\uAC74\uB108\uB700)" : "\uC2A4\uD0AC \uB3D9\uC77C";
  return `\uC5D0\uC774\uC804\uD2B8 \uD1B5\uD569: ${agents} / ${claude} / \uB798\uD37C ${result.wrapper === "written" ? "\uC124\uCE58" : "\uB3D9\uC77C"} / ${skill} (Claude/Codex/Antigravity/OpenCode)`;
}
async function installAgentIntegration(vaultPath, pluginDir) {
  const wrapperPath = path.join(pluginDir, WRAPPER_REL);
  const wrapperChanged = await writeIfChanged(wrapperPath, SEARCH_PS1);
  const wrapper = wrapperChanged ? "written" : "unchanged";
  const fileStatus = {};
  for (const name of INSTRUCTION_FILES) {
    const target = path.join(vaultPath, name);
    const existing = await readOptional(target);
    const result = updateAgentsFile(existing, AGENTS_BLOCK);
    if (result.content !== null) {
      await (0, import_promises.writeFile)(target, result.content, "utf8");
    }
    fileStatus[name] = result.status;
  }
  const skill = await installSkills(vaultPath);
  return {
    agentsFile: fileStatus[AGENTS_FILE] ?? "unchanged",
    claudeFile: fileStatus[CLAUDE_FILE] ?? "unchanged",
    wrapper,
    skill,
    wrapperPath: path.join(
      ".obsidian",
      "plugins",
      path.basename(pluginDir),
      WRAPPER_REL
    )
  };
}
async function agentIntegrationStatus(vaultPath, pluginDir) {
  const readFileStatus = async (name) => {
    const content = await readForStatus(path.join(vaultPath, name));
    if (content === null) return "absent";
    if (content.includes(AGENTS_MARKER_START)) return "managed";
    if (CONFLICT_RE.test(content)) return "conflict";
    return "plain";
  };
  const agentsFile = await readFileStatus(AGENTS_FILE);
  const claudeFile = await readFileStatus(CLAUDE_FILE);
  const wrapper = await readForStatus(path.join(pluginDir, WRAPPER_REL)) !== null;
  const skillContent = await readForStatus(
    path.join(vaultPath, ...SKILL_TARGETS[0])
  );
  const skill = skillContent === null ? "absent" : skillContent.includes(SKILL_MARKER) ? "managed" : "other";
  const agentsSkill = await readForStatus(
    path.join(vaultPath, ".agents", "skills", "vault-search", "SKILL.md")
  ) !== null;
  return { agentsFile, claudeFile, wrapper, skill, agentsSkill };
}

// src/backend-manager.ts
var import_child_process = require("child_process");
var import_fs = require("fs");
var import_promises2 = require("fs/promises");
var path3 = __toESM(require("path"));
var import_adm_zip = __toESM(require_adm_zip());
var import_obsidian = require("obsidian");

// src/constants.ts
var PROTOCOL_VERSION = 1;
var VIEW_TYPE_VAULT_AI_SEARCH = "vault-ai-search";
var BACKEND_VERSION = "0.1.23";
var GITHUB_REPO = "kalkin7/obsidian-vault-search";
var MODEL_PROFILES = {
  "multilingual-e5-base": {
    name: "Multilingual E5 Base (\uAD8C\uC7A5, \uC800\uC790\uC6D0)",
    modelId: "intfloat/multilingual-e5-base",
    queryPrefix: "query: ",
    documentPrefix: "passage: ",
    note: "\uD604\uC7AC K_Notes \uAE30\uBCF8 \uBAA8\uB378. \uC57D 1.2GB \uBA54\uBAA8\uB9AC, CPU \uAC80\uC0C9\uC774 \uBE60\uB985\uB2C8\uB2E4."
  },
  "bge-m3": {
    name: "BGE-M3 (\uACE0\uC131\uB2A5, \uACE0\uC790\uC6D0)",
    modelId: "BAAI/bge-m3",
    queryPrefix: "",
    documentPrefix: "",
    note: "\uC57D 2.3GB \uBA54\uBAA8\uB9AC. \uBAA8\uB378 \uBCC0\uACBD \uD6C4 \uBCA1\uD130 \uC7AC\uAD6C\uCD95\uC774 \uD544\uC694\uD569\uB2C8\uB2E4."
  },
  koe5: {
    name: "KoE5 (\uD55C\uAD6D\uC5B4 \uD2B9\uD654, \uACE0\uC790\uC6D0)",
    modelId: "nlpai-lab/KoE5",
    queryPrefix: "query: ",
    documentPrefix: "passage: ",
    note: "\uD55C\uAD6D\uC5B4 \uD2B9\uD654 \uBAA8\uB378. \uC57D 2.3GB \uBA54\uBAA8\uB9AC\uC785\uB2C8\uB2E4."
  },
  custom: {
    name: "\uC0AC\uC6A9\uC790 \uC9C0\uC815 Sentence Transformers \uBAA8\uB378",
    modelId: "",
    queryPrefix: "",
    documentPrefix: "",
    note: "Hugging Face \uBAA8\uB378 ID\uC640 \uC811\uB450\uC5B4\uB97C \uC9C1\uC811 \uC9C0\uC815\uD569\uB2C8\uB2E4."
  }
};
var DEFAULT_SETTINGS = {
  loadPolicy: "first-search",
  pythonExecutable: "python",
  modelProfile: "multilingual-e5-base",
  modelId: "intfloat/multilingual-e5-base",
  engine: "onnx",
  provider: "auto",
  device: "auto",
  queryPrefix: "query: ",
  documentPrefix: "passage: ",
  normalizeEmbeddings: true,
  includeGlobs: ["**/*.md"],
  excludeGlobs: [".obsidian/**", "**/node_modules/**"],
  wikiFolders: ["5_Wiki/issues", "5_Wiki/entities", "5_Wiki/decisions"],
  chunkChars: 400,
  chunkOverlap: 60,
  chunkingStrategy: "paragraph-v1",
  bm25TopK: 80,
  vectorTopK: 80,
  finalTopK: 40,
  rrfK: 60,
  maxChunksPerFile: 1,
  titleRrfWeight: 1,
  prefixFallback: true,
  syncDebounceMs: 1500,
  autoSync: true,
  startupReconcile: true,
  modelIdleTimeoutSeconds: 300,
  answerProvider: "openai",
  answerModel: "",
  favoriteAnswerModels: [],
  answerMaxContextChars: 24e3,
  answerMaxOutputTokens: 1200,
  answerTimeoutSeconds: 60
};
var LLM_PROVIDER_DEFAULTS = {
  openai: {
    name: "OpenAI Responses API",
    model: "gpt-5.6",
    env: "OPENAI_API_KEY"
  },
  "opencode-go": {
    name: "OpenCode Go",
    model: "deepseek-v4-flash",
    env: "OPENCODE_GO_API_KEY"
  },
  deepseek: {
    name: "DeepSeek",
    model: "deepseek-v4-flash",
    env: "DEEPSEEK_API_KEY"
  }
};
var LLM_SECRET_IDS = {
  openai: "vault-search-openai-api-key",
  "opencode-go": "vault-search-opencode-go-api-key",
  deepseek: "vault-search-deepseek-api-key"
};
var LLM_MODEL_ENDPOINTS = {
  openai: "https://api.openai.com/v1/models",
  "opencode-go": "https://opencode.ai/zen/go/v1/models",
  deepseek: "https://api.deepseek.com/models"
};

// src/backend-protocol.ts
var net = __toESM(require("net"));
var import_crypto = require("crypto");
function requestBackend(runtime, method, params = {}, timeoutMs = 3e3) {
  return new Promise((resolve3, reject) => {
    const requestId = (0, import_crypto.randomUUID)();
    const socket = net.createConnection({ host: runtime.host || "127.0.0.1", port: runtime.port });
    let buffer = "";
    let settled = false;
    const finishError = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(timeoutMs, () => finishError(new Error(`Backend request timed out: ${method}`)));
    socket.on("error", finishError);
    socket.on("connect", () => {
      socket.write(JSON.stringify({
        protocol_version: PROTOCOL_VERSION,
        request_id: requestId,
        token: runtime.token,
        method,
        params
      }) + "\n", "utf8");
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        const response = JSON.parse(buffer.slice(0, newline));
        if (response.request_id !== requestId) throw new Error("Mismatched backend request ID");
        settled = true;
        socket.end();
        resolve3(response);
      } catch (error) {
        finishError(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.on("close", () => {
      if (!settled) finishError(new Error("Backend closed without a response"));
    });
  });
}

// src/runtime-paths.ts
var import_crypto2 = require("crypto");
var path2 = __toESM(require("path"));
function canonicalVaultPath(vaultPath) {
  const normalized = path2.resolve(vaultPath).replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
function vaultId(vaultPath) {
  return (0, import_crypto2.createHash)("sha256").update(canonicalVaultPath(vaultPath), "utf8").digest("hex").slice(0, 20);
}
function localDataRoot() {
  const root = process.env.LOCALAPPDATA || path2.join(process.env.HOME || process.cwd(), ".local", "share");
  return path2.join(root, "ObsidianVaultSearch");
}
function vaultDataDir(vaultPath) {
  return path2.join(localDataRoot(), "vaults", vaultId(vaultPath));
}

// src/llm-secrets.ts
function storage(app) {
  return app.secretStorage;
}
function hasSecretStorage(app) {
  return Boolean(storage(app));
}
function getProviderSecret(app, provider) {
  return storage(app)?.getSecret(LLM_SECRET_IDS[provider])?.trim() || "";
}
function setProviderSecret(app, provider, secret) {
  const secretStorage = storage(app);
  if (!secretStorage) {
    throw new Error("\uC774 \uBC84\uC804\uC758 Obsidian\uC740 \uBCF4\uC548 \uD0A4 \uC800\uC7A5\uC18C\uB97C \uC9C0\uC6D0\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. Obsidian 1.11.4 \uC774\uC0C1\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.");
  }
  secretStorage.setSecret(LLM_SECRET_IDS[provider], secret.trim());
}
function providerEnvironment(app) {
  const environment = {};
  const secretStorage = storage(app);
  if (!secretStorage) return environment;
  for (const provider of Object.keys(LLM_PROVIDER_DEFAULTS)) {
    const stored = secretStorage.getSecret(LLM_SECRET_IDS[provider]);
    if (stored !== null) {
      environment[LLM_PROVIDER_DEFAULTS[provider].env] = stored.trim();
    }
  }
  return environment;
}
function mergeProviderEnvironment(inherited, providerValues) {
  const environment = { ...inherited };
  for (const name of Object.keys(providerValues)) delete environment[name];
  Object.assign(environment, providerValues);
  return environment;
}

// src/backend-manager.ts
var BackendManager = class {
  constructor(vaultPath, pluginDir, getSettings, statusChanged, manifestVersion = BACKEND_VERSION, getEnvironment = () => ({})) {
    this.vaultPath = vaultPath;
    this.pluginDir = pluginDir;
    this.getSettings = getSettings;
    this.statusChanged = statusChanged;
    this.manifestVersion = manifestVersion;
    this.getEnvironment = getEnvironment;
  }
  child = null;
  runtime = null;
  heartbeat = null;
  stopping = false;
  runtimeInstall = null;
  runtimeInstaller = null;
  machineWrite = Promise.resolve();
  startPromise = null;
  backendProvision = null;
  startGeneration = 0;
  statusValue = { state: "stopped" };
  ownership = "none";
  get dataDir() {
    return vaultDataDir(this.vaultPath);
  }
  get runtimePath() {
    return path3.join(this.dataDir, "runtime.json");
  }
  get configPath() {
    return path3.join(this.dataDir, "service-config.json");
  }
  get machinePath() {
    return path3.join(this.dataDir, "machine.json");
  }
  get backendRoot() {
    return path3.join(this.pluginDir, "backend");
  }
  get status() {
    return { ...this.statusValue };
  }
  async readMachinePython() {
    const config = await this.readMachineConfig();
    return config.pythonExecutable || null;
  }
  async readMachineConfig() {
    try {
      return JSON.parse(
        await (0, import_promises2.readFile)(this.machinePath, "utf8")
      );
    } catch {
      return {};
    }
  }
  async writeMachinePython(pythonExecutable) {
    await this.updateMachineConfig((config) => {
      config.pythonExecutable = pythonExecutable;
    });
  }
  async writeManagedRuntime(kind, pythonExecutable) {
    await this.updateMachineConfig((config) => {
      config.runtimes = {
        ...config.runtimes || {},
        [kind]: pythonExecutable
      };
    });
  }
  async updateMachineConfig(change) {
    const operation = this.machineWrite.then(async () => {
      await (0, import_promises2.mkdir)(this.dataDir, { recursive: true });
      const config = await this.readMachineConfig();
      change(config);
      const suffix = `${process.pid}.${Date.now()}`;
      const temp = `${this.machinePath}.${suffix}.tmp`;
      const backup = `${this.machinePath}.${suffix}.backup`;
      await (0, import_promises2.writeFile)(temp, JSON.stringify(config, null, 2), "utf8");
      let backedUp = false;
      try {
        if ((0, import_fs.existsSync)(this.machinePath)) {
          await (0, import_promises2.rename)(this.machinePath, backup);
          backedUp = true;
        }
        await (0, import_promises2.rename)(temp, this.machinePath);
        if (backedUp) await (0, import_promises2.rm)(backup, { force: true });
      } catch (error) {
        await (0, import_promises2.rm)(temp, { force: true }).catch(() => void 0);
        if (backedUp && !(0, import_fs.existsSync)(this.machinePath))
          await (0, import_promises2.rename)(backup, this.machinePath);
        throw error;
      }
    });
    this.machineWrite = operation.catch(() => void 0);
    return operation;
  }
  async inspectPython(pythonExecutable) {
    const code = [
      "import importlib.util,json,sys,torch,onnxruntime,vault_search",
      "required=['transformers','tokenizers','sentence_transformers','kiwipiepy','usearch','numpy','onnxruntime']",
      "assert all(importlib.util.find_spec(name) for name in required)",
      "providers=onnxruntime.get_available_providers()",
      "ort_cuda='CUDAExecutionProvider' in providers or 'TensorrtExecutionProvider' in providers",
      "print(json.dumps({'executable':sys.executable,'base':sys._base_executable,'torch':torch.__version__,'onnxruntime':onnxruntime.__version__,'ort_providers':providers,'backend':vault_search.__version__,'cuda_build':torch.version.cuda,'cuda_available':torch.cuda.is_available() and ort_cuda,'device_name':torch.cuda.get_device_name(0) if torch.cuda.is_available() else None}))"
    ].join(";");
    try {
      const stdout = await this.execFileText(
        pythonExecutable,
        ["-X", "utf8", "-c", code],
        15e3,
        { PYTHONPATH: this.backendRoot }
      );
      const value = JSON.parse(stdout.trim());
      if (String(value.backend || "") !== BACKEND_VERSION) return null;
      return {
        // Prefer the resolved interpreter path (sys.executable) over the input
        // string: the input may be a bare command like "python", which would be
        // persisted and later rejected by Test-Path / Path.exists().
        pythonExecutable: String(value.executable || pythonExecutable),
        baseExecutable: String(value.base || pythonExecutable),
        torchVersion: String(value.torch || "unknown"),
        cudaBuild: value.cuda_build ? String(value.cuda_build) : null,
        cudaAvailable: value.cuda_available === true,
        deviceName: value.device_name ? String(value.device_name) : null
      };
    } catch {
      return null;
    }
  }
  async hasNvidiaGpu() {
    try {
      await this.execFileText(
        "nvidia-smi.exe",
        ["--query-gpu=name", "--format=csv,noheader"],
        1e4
      );
      return true;
    } catch {
      return false;
    }
  }
  async managedRuntime(kind) {
    const executable = (await this.readMachineConfig()).runtimes?.[kind];
    return executable ? this.inspectPython(executable) : null;
  }
  async installManagedRuntime(kind, basePython, progress) {
    if (this.runtimeInstall) return this.runtimeInstall;
    this.runtimeInstall = this.runRuntimeInstall(kind, basePython, progress);
    try {
      return await this.runtimeInstall;
    } finally {
      this.runtimeInstall = null;
    }
  }
  async runRuntimeInstall(kind, basePython, progress) {
    const script = path3.join(this.backendRoot, "setup-runtime.ps1");
    if (!(0, import_fs.existsSync)(script))
      throw new Error(`Runtime installer is missing: ${script}`);
    const executable = await new Promise((resolve3, reject) => {
      const child = (0, import_child_process.spawn)(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          script,
          "-PythonExecutable",
          basePython,
          "-Version",
          BACKEND_VERSION,
          "-Runtime",
          kind
        ],
        {
          cwd: this.pluginDir,
          windowsHide: true,
          shell: false,
          env: { ...process.env, PYTHONUTF8: "1" }
        }
      );
      this.runtimeInstaller = child;
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        stdout += text;
        progress(text.trim());
      });
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        stderr += text;
        progress(text.trim());
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        this.runtimeInstaller = null;
        if (code === 0)
          resolve3(stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || "");
        else
          reject(
            new Error(
              stderr.trim() || `Runtime installer exited with code ${code}`
            )
          );
      });
    });
    const info = await this.inspectPython(executable);
    if (!info) throw new Error("Installed runtime validation failed");
    if (kind === "cuda" && !info.cudaAvailable) {
      throw new Error(
        "CUDA runtime was installed, but CUDA is not available to PyTorch. Check the NVIDIA driver."
      );
    }
    await this.writeManagedRuntime(kind, executable);
    return info;
  }
  execFileText(executable, args, timeout, extraEnv) {
    return new Promise((resolve3, reject) => {
      (0, import_child_process.execFile)(
        executable,
        args,
        {
          timeout,
          windowsHide: true,
          encoding: "utf8",
          env: extraEnv ? { ...process.env, ...extraEnv } : void 0
        },
        (error, stdout) => error ? reject(error) : resolve3(stdout)
      );
    });
  }
  async readBackendVersion() {
    try {
      const content = await (0, import_promises2.readFile)(
        path3.join(this.backendRoot, "vault_search", "__init__.py"),
        "utf8"
      );
      const match = /__version__\s*=\s*["']([^"']+)["']/.exec(content);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }
  /** Ensure the Python backend folder exists in the plugin directory and matches
   *  the plugin version. BRAT only installs main.js/manifest/styles.css, so the
   *  sidecar is self-provisioned from the release zip (or via the settings
   *  button) instead of being carried by BRAT. Serialized so automatic startup
   *  and the manual repair button cannot race each other. */
  ensureBackendProvisioned(opts = {}) {
    if (!this.backendProvision) {
      this.backendProvision = this.provisionBackendFiles(
        opts.force ?? false
      ).finally(() => {
        this.backendProvision = null;
      });
    }
    return this.backendProvision;
  }
  async provisionBackendFiles(force) {
    const current = await this.readBackendVersion();
    if (!force && current === this.manifestVersion) return true;
    const existing = path3.join(this.pluginDir, "backend");
    if (!(0, import_fs.existsSync)(existing)) {
      const backups = await (0, import_promises2.readdir)(this.pluginDir).catch(() => []);
      const candidates = backups.filter((n) => n.startsWith("backend.bak.")).sort();
      for (const name of candidates.reverse()) {
        const backupPath = path3.join(this.pluginDir, name);
        try {
          await (0, import_promises2.rename)(backupPath, existing);
          break;
        } catch {
        }
      }
    }
    const version = this.manifestVersion;
    const zipUrl = `https://github.com/${GITHUB_REPO}/releases/download/v${version}/obsidian-vault-search-v${version}.zip`;
    let response;
    try {
      response = await (0, import_obsidian.requestUrl)({ url: zipUrl, throw: false });
    } catch (error) {
      throw new Error(
        `\uBC31\uC5D4\uB4DC \uB2E4\uC6B4\uB85C\uB4DC \uC2E4\uD328: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (response.status !== 200) {
      throw new Error(
        `\uBC31\uC5D4\uB4DC \uB2E4\uC6B4\uB85C\uB4DC \uC2E4\uD328 (HTTP ${response.status}): ${zipUrl}`
      );
    }
    const zip = new import_adm_zip.default(Buffer.from(response.arrayBuffer));
    const backendEntries = zip.getEntries().filter((e) => e.entryName.startsWith("backend/") && !e.isDirectory);
    if (backendEntries.length === 0) {
      throw new Error("\uB9B4\uB9AC\uC2A4 zip\uC5D0 backend/ \uD3F4\uB354\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4");
    }
    const initEntry = zip.getEntries().find((e) => e.entryName === "backend/vault_search/__init__.py");
    const versionMatch = initEntry ? /__version__\s*=\s*["']([^"']+)["']/.exec(
      initEntry.getData().toString("utf8")
    ) : null;
    if (!versionMatch || versionMatch[1] !== this.manifestVersion) {
      throw new Error(
        `\uB9B4\uB9AC\uC2A4 zip\uC758 \uBC31\uC5D4\uB4DC \uBC84\uC804\uC774 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4: \uAE30\uB300 ${this.manifestVersion}, \uBC1C\uACAC ${versionMatch ? versionMatch[1] : "\uC5C6\uC74C"}. ${zipUrl}`
      );
    }
    const tempRoot = path3.join(
      this.pluginDir,
      `backend.provision-${Date.now()}`
    );
    const tempBackend = path3.join(tempRoot, "backend");
    try {
      for (const entry of backendEntries) {
        const rel = entry.entryName.slice("backend/".length);
        const dest = path3.resolve(tempBackend, rel);
        const inside = path3.relative(tempBackend, dest);
        if (path3.isAbsolute(rel) || inside === "" || inside.startsWith("..")) {
          throw new Error(
            `\uC548\uC804\uD558\uC9C0 \uC54A\uC740 zip \uD56D\uBAA9\uC774 \uAC10\uC9C0\uB418\uC5B4 \uC911\uB2E8\uD569\uB2C8\uB2E4: ${entry.entryName}`
          );
        }
        await (0, import_promises2.mkdir)(path3.dirname(dest), { recursive: true });
        await (0, import_promises2.writeFile)(dest, entry.getData());
      }
      const backup = path3.join(this.pluginDir, `backend.bak.${Date.now()}`);
      if ((0, import_fs.existsSync)(existing)) await (0, import_promises2.rename)(existing, backup);
      try {
        await (0, import_promises2.rename)(tempBackend, existing);
      } catch (error) {
        let rollbackError;
        try {
          await (0, import_promises2.rename)(backup, existing);
        } catch (e) {
          rollbackError = e;
        }
        if (rollbackError) {
          throw new Error(
            `\uBC31\uC5D4\uB4DC \uAD50\uCCB4 \uC2E4\uD328: ${error instanceof Error ? error.message : String(error)}; \uBCF5\uAD6C\uB3C4 \uC2E4\uD328 \u2014 \uBC31\uC5C5\uC744 \uC720\uC9C0\uD569\uB2C8\uB2E4: ${backup}`
          );
        }
        throw error;
      }
      const backups = await (0, import_promises2.readdir)(this.pluginDir).catch(() => []);
      for (const name of backups.filter((n) => n.startsWith("backend.bak."))) {
        await (0, import_promises2.rm)(path3.join(this.pluginDir, name), {
          recursive: true,
          force: true
        }).catch(() => void 0);
      }
    } finally {
      await (0, import_promises2.rm)(tempRoot, { recursive: true, force: true }).catch(
        () => void 0
      );
    }
    return true;
  }
  async start(lazyOverride) {
    if (this.child && this.child.exitCode === null) return;
    if (this.startPromise) return this.startPromise;
    const generation = ++this.startGeneration;
    this.startPromise = this.startInternal(lazyOverride, generation);
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }
  async startInternal(lazyOverride, generation) {
    this.stopping = false;
    this.setStatus({ state: "starting" });
    await (0, import_promises2.mkdir)(this.dataDir, { recursive: true });
    const providerEnvironment2 = this.getEnvironment();
    if (Object.keys(providerEnvironment2).length === 0 && await this.tryAttachStandalone()) return;
    await this.stopStaleRuntime();
    try {
      await this.ensureBackendProvisioned();
    } catch (error) {
      this.setStatus({
        state: "error",
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
    if (!(0, import_fs.existsSync)(path3.join(this.backendRoot, "vault_search", "__main__.py"))) {
      throw new Error(`Python backend is missing: ${this.backendRoot}`);
    }
    await this.writeServiceConfig(lazyOverride);
    if (generation !== this.startGeneration || this.stopping) return;
    const settings = this.getSettings();
    const args = [
      "-X",
      "utf8",
      "-m",
      "vault_search",
      "serve",
      "--config",
      this.configPath,
      "--vault",
      this.vaultPath,
      "--data-dir",
      this.dataDir,
      "--parent-pid",
      String(process.pid),
      "--watch-stdin"
    ];
    const env = mergeProviderEnvironment(process.env, providerEnvironment2);
    env.PYTHONUTF8 = "1";
    env.PYTHONPATH = this.backendRoot + (env.PYTHONPATH ? path3.delimiter + env.PYTHONPATH : "");
    env.HF_HUB_DISABLE_PROGRESS_BARS = "1";
    const child = (0, import_child_process.spawn)(settings.pythonExecutable || "python", args, {
      cwd: this.pluginDir,
      env,
      detached: false,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child = child;
    this.ownership = "child";
    const log = (0, import_fs.createWriteStream)(path3.join(this.dataDir, "backend.log"), {
      flags: "a"
    });
    let stdoutBuffer = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdoutBuffer += text;
      let newline = stdoutBuffer.indexOf("\n");
      while (newline >= 0) {
        const line = stdoutBuffer.slice(0, newline).trim();
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        if (line) {
          log.write(this.redactLogLine(line) + "\n");
          this.handleBackendLine(line);
        }
        newline = stdoutBuffer.indexOf("\n");
      }
    });
    child.stderr.on("data", (chunk) => log.write(chunk));
    child.on("error", (error) => {
      this.setStatus({ state: "error", error: error.message });
    });
    child.on("exit", (code, signal) => {
      log.end(`
[plugin] backend exit code=${code} signal=${signal}
`);
      this.child = null;
      this.runtime = null;
      this.clearHeartbeat();
      if (!this.stopping && code !== 0) {
        this.setStatus({
          state: "error",
          error: `Backend exited: code=${code}, signal=${signal}`
        });
      } else {
        this.setStatus({ state: "stopped" });
      }
    });
  }
  async waitUntilAvailable(timeoutMs = 1e4) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (this.ownership === "attached")
        await this.refreshStatus().catch(() => void 0);
      const state = this.statusValue.state;
      if (["idle", "loading_model", "ready", "ready_no_index"].includes(state))
        return this.status;
      if (state === "error")
        throw new Error(this.statusValue.error || "Backend failed");
      await new Promise((resolve3) => setTimeout(resolve3, 100));
    }
    throw new Error("Backend did not start listening");
  }
  async waitUntilReady(timeoutMs = 18e4) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (this.ownership === "attached")
        await this.refreshStatus().catch(() => void 0);
      const state = this.statusValue.state;
      if (state === "ready" || state === "ready_no_index") return this.status;
      if (state === "error")
        throw new Error(this.statusValue.error || "Backend failed");
      await new Promise((resolve3) => setTimeout(resolve3, 250));
    }
    throw new Error("Backend model loading timed out");
  }
  async refreshStatus() {
    const runtime = this.runtime || await this.readRuntime();
    if (!runtime) return;
    const response = await requestBackend(
      runtime,
      "status",
      {},
      3e3
    );
    if (response.ok) {
      this.setStatus({
        ...response.data || {},
        pid: runtime.pid,
        port: runtime.port
      });
    }
  }
  async stop(preserveAttached = false) {
    this.stopping = true;
    ++this.startGeneration;
    const installer = this.runtimeInstaller;
    if (installer && installer.exitCode === null) {
      installer.kill();
      if (process.platform === "win32" && installer.pid) {
        await new Promise((resolve3) => {
          (0, import_child_process.execFile)(
            "taskkill.exe",
            ["/PID", String(installer.pid), "/T", "/F"],
            () => resolve3()
          );
        });
      }
      this.runtimeInstaller = null;
    }
    const starting = this.startPromise;
    if (starting) await starting.catch(() => void 0);
    this.clearHeartbeat();
    const child = this.child;
    const runtime = this.runtime || await this.readRuntime();
    if (this.ownership === "attached" && preserveAttached) {
      this.runtime = null;
      this.child = null;
      this.ownership = "none";
      this.setStatus({ state: "stopped" });
      return;
    }
    if (child?.stdin.writable) child.stdin.end();
    const ownedPid = runtime?.pid ?? child?.pid;
    if (runtime) {
      try {
        await requestBackend(runtime, "shutdown", {}, 2e3);
      } catch {
      }
    }
    if (runtime && !child) {
      const deadline = Date.now() + 1e4;
      while (this.pidRunning(ownedPid) && Date.now() < deadline) {
        await new Promise((resolve3) => setTimeout(resolve3, 200));
      }
      if (this.pidRunning(ownedPid)) {
        throw new Error(`Standalone backend did not stop: PID ${ownedPid}`);
      }
    }
    if (child && child.exitCode === null) {
      const exited = await this.waitForExit(child, 5e3);
      if (!exited) {
        child.kill();
        if (process.platform === "win32" && child.pid) {
          await new Promise((resolve3) => {
            (0, import_child_process.execFile)(
              "taskkill.exe",
              ["/PID", String(child.pid), "/T", "/F"],
              () => resolve3()
            );
          });
        }
      }
    }
    try {
      const current = await this.readRuntime();
      if (!current || current.pid === ownedPid)
        await (0, import_promises2.rm)(this.runtimePath, { force: true });
    } catch {
    }
    this.runtime = null;
    this.child = null;
    this.ownership = "none";
    this.setStatus({ state: "stopped" });
  }
  async restart() {
    await this.stop();
    await this.start(false);
    await this.waitUntilReady();
  }
  async call(method, params = {}, timeoutMs = 5e3) {
    let runtime = this.runtime;
    if (!runtime) runtime = await this.readRuntime();
    if (!runtime) throw new Error("Backend is not running");
    const response = await requestBackend(
      runtime,
      method,
      params,
      timeoutMs
    );
    if (!response.ok) {
      throw new BackendCallError(
        response.error?.code || "BACKEND_ERROR",
        response.error?.message || "Backend request failed",
        response.error?.details
      );
    }
    const data = response.data;
    if (data && typeof data === "object" && "state" in data) {
      this.setStatus({
        ...data,
        pid: runtime.pid,
        port: runtime.port
      });
    }
    return data;
  }
  async ensureStarted() {
    if (!this.child || this.child.exitCode !== null) await this.start(false);
    await this.waitUntilAvailable();
    if (this.statusValue.state === "idle") {
      await this.call("load_model", {});
    }
    await this.waitUntilReady();
  }
  async writeServiceConfig(lazyOverride) {
    const settings = this.getSettings();
    const payload = {
      vaultPath: this.vaultPath,
      dataDir: this.dataDir,
      ...settings,
      lazyModel: lazyOverride ?? settings.loadPolicy === "first-search"
    };
    const temp = this.configPath + ".tmp";
    await (0, import_promises2.writeFile)(temp, JSON.stringify(payload, null, 2), "utf8");
    try {
      await (0, import_promises2.rename)(temp, this.configPath);
    } catch {
      await (0, import_promises2.rm)(this.configPath, { force: true });
      await (0, import_promises2.rename)(temp, this.configPath);
    }
  }
  redactLogLine(line) {
    try {
      const value = JSON.parse(line);
      if (value.data?.token) value.data.token = "<redacted>";
      return JSON.stringify(value);
    } catch {
      return line;
    }
  }
  handleBackendLine(line) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (!event.event || !event.data) return;
    if (event.event === "listening") {
      this.runtime = event.data;
      this.setStatus({
        state: String(event.data.state || "loading_model") === "idle" ? "idle" : "loading_model",
        pid: Number(event.data.pid),
        port: Number(event.data.port),
        model_id: String(event.data.model_id || "")
      });
      void this.readRuntime().then((runtime) => {
        if (runtime) this.runtime = runtime;
        this.startHeartbeat();
      });
      return;
    }
    if (event.event === "idle") {
      this.setStatus({
        ...event.data,
        state: "idle",
        pid: this.runtime?.pid,
        port: this.runtime?.port
      });
      return;
    }
    if (event.event === "ready") {
      this.setStatus({
        ...event.data,
        pid: this.runtime?.pid,
        port: this.runtime?.port
      });
      return;
    }
    if (event.event === "rebuild_progress") {
      this.setStatus({
        progress: `${Number(event.data.processed_files || 0)}/${Number(event.data.total_files || 0)} \uD30C\uC77C, ${Number(event.data.chunks || 0)} \uCCAD\uD06C`
      });
      return;
    }
    if (event.event === "rebuild_started") {
      this.setStatus({ progress: `0/${Number(event.data.files || 0)} \uD30C\uC77C` });
      return;
    }
    if (event.event === "embedding_started") {
      this.setStatus({
        progress: `${Number(event.data.chunks || 0)}\uAC1C \uCCAD\uD06C \uC784\uBCA0\uB529 \uC911`
      });
      return;
    }
    if (event.event === "embedding_finished") {
      this.setStatus({
        progress: `${Number(event.data.chunks || 0)}\uAC1C \uCCAD\uD06C \uC784\uBCA0\uB529 \uC644\uB8CC, \uAC80\uC99D \uC911`
      });
      return;
    }
    if (event.event === "rebuild_finished") {
      this.setStatus({ progress: void 0 });
      return;
    }
    if (event.event === "state" || event.event === "error") {
      this.setStatus({
        ...event.data,
        pid: this.runtime?.pid,
        port: this.runtime?.port
      });
    }
  }
  startHeartbeat() {
    this.clearHeartbeat();
    const pulse = () => {
      if (!this.runtime) return;
      void requestBackend(this.runtime, "heartbeat", {}, 2e3).catch(
        () => void 0
      );
    };
    pulse();
    this.heartbeat = setInterval(pulse, 5e3);
  }
  clearHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
  setStatus(status) {
    if (status.state === "stopped" || status.state === "starting") {
      this.statusValue = { ...status };
    } else {
      this.statusValue = { ...this.statusValue, ...status };
    }
    this.statusChanged(this.status);
  }
  async readRuntime() {
    try {
      return JSON.parse(
        await (0, import_promises2.readFile)(this.runtimePath, "utf8")
      );
    } catch {
      return null;
    }
  }
  /** Attach to a healthy standalone backend instead of spawning a child.
   *  A standalone daemon started by the CLI must survive plugin reloads, so it
   *  is adopted (heartbeat kept, ownership "attached") and never killed by the
   *  plugin lifecycle. */
  async tryAttachStandalone() {
    const runtime = await this.readRuntime();
    if (!runtime) return false;
    if (runtime.owner !== "standalone") return false;
    if (runtime.protocol_version !== PROTOCOL_VERSION) return false;
    if (runtime.backend_version && runtime.backend_version !== this.manifestVersion)
      return false;
    if (runtime.vault_path && this.vaultPath) {
      const normalized = (value) => value.replace(/\\/g, "/").toLowerCase();
      if (normalized(runtime.vault_path) !== normalized(this.vaultPath))
        return false;
    }
    if (!this.pidRunning(runtime.pid)) return false;
    let statusData;
    try {
      const response = await requestBackend(
        runtime,
        "status",
        {},
        2e3
      );
      if (!response.ok) return false;
      statusData = response.data ?? { state: "stopped" };
    } catch {
      return false;
    }
    this.runtime = runtime;
    this.child = null;
    this.ownership = "attached";
    this.setStatus({ ...statusData, pid: runtime.pid, port: runtime.port });
    this.startHeartbeat();
    return true;
  }
  stopStaleRuntime() {
    return this.stopExistingRuntime(false);
  }
  async stopExistingRuntime(preserveAttached) {
    const runtime = await this.readRuntime();
    if (!runtime) return;
    let authentic = false;
    if (this.pidRunning(runtime.pid)) {
      try {
        const status = await requestBackend(runtime, "status", {}, 2e3);
        authentic = status.ok;
      } catch {
        authentic = false;
      }
    }
    if (runtime.owner === "standalone" && preserveAttached && authentic) return;
    if (!authentic) {
      await (0, import_promises2.rm)(this.runtimePath, { force: true }).catch(() => void 0);
      return;
    }
    try {
      await requestBackend(runtime, "shutdown", {}, 1e3);
    } catch {
    }
    const deadline = Date.now() + 1e4;
    while (this.pidRunning(runtime.pid) && Date.now() < deadline) {
      await new Promise((resolve3) => setTimeout(resolve3, 200));
    }
    if (this.pidRunning(runtime.pid)) {
      throw new Error(
        `Existing Vault Search backend did not stop: PID ${runtime.pid}`
      );
    }
    await (0, import_promises2.rm)(this.runtimePath, { force: true });
  }
  pidRunning(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
  waitForExit(child, timeoutMs) {
    if (child.exitCode !== null) return Promise.resolve(true);
    return new Promise((resolve3) => {
      const timer = setTimeout(() => resolve3(false), timeoutMs);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve3(true);
      });
    });
  }
};
var BackendCallError = class extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
};

// src/settings-tab.ts
var import_obsidian2 = require("obsidian");

// src/settings.ts
var ALL_KEYS = [
  "chunkChars",
  "chunkOverlap",
  "chunkingStrategy"
];
var VECTOR_KEYS = [
  "modelProfile",
  "modelId",
  "device",
  "engine",
  "queryPrefix",
  "documentPrefix",
  "normalizeEmbeddings"
];
var SCOPE_KEYS = [
  "includeGlobs",
  "excludeGlobs"
];
var RESTART_KEYS = [
  "pythonExecutable",
  "modelIdleTimeoutSeconds"
];
var HOT_KEYS = [
  "bm25TopK",
  "vectorTopK",
  "finalTopK",
  "rrfK",
  "maxChunksPerFile",
  "titleRrfWeight",
  "prefixFallback",
  "wikiFolders",
  "answerProvider",
  "answerModel",
  "favoriteAnswerModels",
  "answerMaxContextChars",
  "answerMaxOutputTokens",
  "answerTimeoutSeconds"
];
function equal(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function defaultLoadPolicy(engine) {
  return engine === "onnx" ? "first-search" : "vault-open";
}
function settingsImpact(current, next) {
  if (ALL_KEYS.some((key) => !equal(current[key], next[key]))) return "all";
  const providerChangedForOnnx = (current.engine === "onnx" || next.engine === "onnx") && !equal(current.provider, next.provider);
  if (VECTOR_KEYS.some((key) => !equal(current[key], next[key])) || providerChangedForOnnx)
    return "vectors";
  if (RESTART_KEYS.some((key) => !equal(current[key], next[key])))
    return "restart";
  if (SCOPE_KEYS.some((key) => !equal(current[key], next[key]))) return "scope";
  if (HOT_KEYS.some((key) => !equal(current[key], next[key]))) return "hot";
  return equal(current, next) ? "none" : "hot";
}
function cloneSettings(settings) {
  return {
    ...settings,
    includeGlobs: [...settings.includeGlobs],
    excludeGlobs: [...settings.excludeGlobs],
    wikiFolders: [...settings.wikiFolders],
    favoriteAnswerModels: (settings.favoriteAnswerModels || []).map(
      (favorite) => ({ ...favorite })
    )
  };
}
function hotConfig(settings) {
  return {
    bm25TopK: settings.bm25TopK,
    vectorTopK: settings.vectorTopK,
    finalTopK: settings.finalTopK,
    rrfK: settings.rrfK,
    maxChunksPerFile: settings.maxChunksPerFile,
    titleRrfWeight: settings.titleRrfWeight,
    prefixFallback: settings.prefixFallback,
    includeGlobs: settings.includeGlobs,
    excludeGlobs: settings.excludeGlobs,
    wikiFolders: settings.wikiFolders,
    answerProvider: settings.answerProvider,
    answerModel: settings.answerModel,
    answerMaxContextChars: settings.answerMaxContextChars,
    answerMaxOutputTokens: settings.answerMaxOutputTokens,
    answerTimeoutSeconds: settings.answerTimeoutSeconds
  };
}
var SETTINGS_VERSION = 2;
var LEGACY_DEFAULT_TOP = { bm25TopK: 30, vectorTopK: 30, finalTopK: 20 };
function migrateSettings(settings) {
  if ((settings.settingsVersion ?? 0) >= SETTINGS_VERSION) return false;
  const top = {
    bm25TopK: settings.bm25TopK,
    vectorTopK: settings.vectorTopK,
    finalTopK: settings.finalTopK
  };
  const untouched = top.bm25TopK === LEGACY_DEFAULT_TOP.bm25TopK && top.vectorTopK === LEGACY_DEFAULT_TOP.vectorTopK && top.finalTopK === LEGACY_DEFAULT_TOP.finalTopK;
  if (untouched) {
    settings.bm25TopK = 80;
    settings.vectorTopK = 80;
    settings.finalTopK = 40;
  }
  if (settings.modelIdleTimeoutSeconds === 0) {
    settings.modelIdleTimeoutSeconds = 300;
  }
  settings.settingsVersion = SETTINGS_VERSION;
  return true;
}

// src/model-catalog.ts
var OPENAI_NON_CHAT_MARKERS = [
  "audio",
  "dall-e",
  "embedding",
  "image",
  "moderation",
  "realtime",
  "transcribe",
  "tts",
  "whisper"
];
var OPENAI_DATED_SNAPSHOT = /-\d{4}-\d{2}-\d{2}$/;
function isSelectableAnswerModel(provider, modelId) {
  if (provider !== "openai") return true;
  const normalized = modelId.trim().toLowerCase();
  if (!normalized || OPENAI_NON_CHAT_MARKERS.some((marker) => normalized.includes(marker))) {
    return false;
  }
  if (OPENAI_DATED_SNAPSHOT.test(normalized)) return false;
  return /^(?:gpt(?:-|$)|chatgpt-|codex-|o\d+(?:-|$))/.test(normalized);
}
function normalizeProviderModels(provider, data) {
  const models = data.map((item) => {
    if (!item || typeof item !== "object") return null;
    const value = item;
    const id = typeof value.id === "string" ? value.id.trim() : "";
    if (!id || !isSelectableAnswerModel(provider, id)) return null;
    return {
      id,
      created: typeof value.created === "number" ? value.created : 0
    };
  }).filter((item) => item !== null).sort((a, b) => b.created - a.created || a.id.localeCompare(b.id));
  return [...new Set(models.map((item) => item.id))].slice(0, 200);
}
function chooseProviderModel(availableModels, rememberedModel, fallbackModel) {
  const remembered = rememberedModel?.trim() || "";
  if (availableModels.length) {
    return availableModels.includes(remembered) ? remembered : availableModels[0];
  }
  return remembered || fallbackModel;
}

// src/settings-tab.ts
var VaultSearchSettingTab = class extends import_obsidian2.PluginSettingTab {
  constructor(owner) {
    super(owner.app, owner);
    this.owner = owner;
  }
  activeTab = "general";
  providerModels = {};
  providerModelSelections = {};
  display() {
    const { containerEl } = this;
    const draft = this.owner.draftSettings;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Vault Search Service" });
    const status = this.owner.backend?.status || { state: "stopped" };
    const statusEl = containerEl.createDiv({ cls: "vault-search-status" });
    statusEl.setText(
      [
        `\uC0C1\uD0DC: ${status.state}`,
        status.model_id ? `\uBAA8\uB378: ${status.model_id}` : "",
        status.device ? `\uB514\uBC14\uC774\uC2A4: ${status.device}` : "",
        this.providerStatusLine(status),
        status.pid ? `PID: ${status.pid} / \uD3EC\uD2B8: ${status.port}` : "",
        status.count_available === false ? "\uC778\uB371\uC2A4 \uAC1C\uC218: \uD655\uC778 \uBD88\uAC00" : status.files === void 0 ? "" : `\uC778\uB371\uC2A4: \uD30C\uC77C ${status.files}\uAC1C / \uCCAD\uD06C ${status.chunks ?? 0}\uAC1C`,
        status.model_load_seconds === void 0 ? "" : `\uCD5C\uADFC \uBAA8\uB378 \uB85C\uB529: ${status.model_load_seconds}\uCD08`,
        status.progress ? `\uC9C4\uD589: ${status.progress}` : "",
        status.pending_recovery_required ? `\uBCF5\uAD6C \uC7AC\uC2DC\uB3C4 \uD544\uC694: ${status.pending_recovery_warning || "pending path journal"}` : "",
        status.index_rebuild_required ? `\uC778\uB371\uC2A4 \uD638\uD658\uC131 \uBB38\uC81C: ${status.recommended_action === "rebuild_vectors" ? "\uBCA1\uD130 \uC7AC\uAD6C\uCD95 \uD544\uC694" : "\uC804\uCCB4 \uC7AC\uAD6C\uCD95 \uD544\uC694"}` : "",
        status.error ? `\uC624\uB958: ${status.error}` : "",
        this.owner.runtimeSummary,
        this.owner.runtimeWarning || ""
      ].filter(Boolean).join("\n")
    );
    if (status.error) statusEl.addClass("vault-search-error");
    const impact = settingsImpact(this.owner.settings, draft);
    new import_obsidian2.Setting(containerEl).setName("\uC11C\uBE44\uC2A4 \uC81C\uC5B4 \uBC0F \uC124\uC815 \uC801\uC6A9").setDesc(
      `\uBAA8\uB378\uC740 \uC774 \uBCFC\uD2B8\uC5D0\uC11C\uB9CC \uC0C1\uC8FC\uD569\uB2C8\uB2E4. \uB300\uAE30 \uC911\uC778 \uC124\uC815 \uC601\uD5A5: ${impact}`
    ).addButton(
      (button) => button.setButtonText("\uC2DC\uC791").onClick(async () => {
        try {
          await this.owner.startBackend();
        } catch (error) {
          this.showError(error);
        }
      })
    ).addButton(
      (button) => button.setButtonText("\uC911\uC9C0").onClick(async () => {
        try {
          await this.owner.stopBackend();
        } catch (error) {
          this.showError(error);
        }
      })
    ).addButton(
      (button) => button.setButtonText("\uC124\uC815 \uC801\uC6A9").setCta().onClick(async () => {
        try {
          await this.owner.applyDraftSettings();
        } catch (error) {
          this.showError(error);
        }
      })
    ).addButton(
      (button) => button.setButtonText("\uBCC0\uACBD \uCDE8\uC18C").onClick(() => this.owner.resetDraftSettings())
    );
    new import_obsidian2.Setting(containerEl).setName("\uC2DC\uC791 \uC815\uCC45").setDesc(
      "\uAE30\uBCF8\uAC12\uC740 \uC5D4\uC9C4\uC5D0 \uB530\uB77C \uC790\uB3D9 \uC870\uC815\uB429\uB2C8\uB2E4: ONNX\uB294 \uCCAB \uAC80\uC0C9 \uC2DC \uB85C\uB4DC, PyTorch\uB294 \uBCFC\uD2B8 \uC5F4 \uB54C \uB85C\uB4DC. \uC5EC\uAE30\uC11C \uC9C1\uC811 \uC120\uD0DD\uD558\uBA74 \uADF8 \uAC12\uC774 \uC720\uC9C0\uB429\uB2C8\uB2E4."
    ).addDropdown(
      (dropdown) => dropdown.addOption("vault-open", "\uBCFC\uD2B8\uB97C \uC5F4 \uB54C \uBAA8\uB378 \uB85C\uB4DC").addOption("first-search", "\uCCAB \uAC80\uC0C9 \uB54C \uBAA8\uB378 \uB85C\uB4DC").addOption("manual", "\uC218\uB3D9 \uC2DC\uC791").setValue(draft.loadPolicy).onChange((value) => {
        draft.loadPolicy = value;
        this.display();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\uC720\uD734 \uBAA8\uB378 \uC5B8\uB85C\uB4DC (\uCD08)").setDesc(
      "\uAE30\uBCF8\uAC12 300\uCD08. 0\uC774\uBA74 \uBE44\uD65C\uC131(\uB85C\uB4DC \uD6C4 \uC0C1\uC8FC). \uAC80\uC0C9\uC774 \uC5C6\uC73C\uBA74 \uC774 \uC2DC\uAC04 \uD6C4 \uBAA8\uB378\uC744 \uC5B8\uB85C\uB4DC\uD569\uB2C8\uB2E4. ONNX \uC5D4\uC9C4\uC740 ORT \uC138\uC158\uC744 \uD574\uC81C\uD574 VRAM/RAM\uC744 \uBC18\uD658\uD558\uACE0, \uB2E4\uC74C \uAC80\uC0C9 \uC2DC \uB2E4\uC2DC \uB85C\uB4DC\uD569\uB2C8\uB2E4. PyTorch \uC5D4\uC9C4\uC740 \uCC38\uC870\uB97C \uD574\uC81C\uD558\uB418 CUDA \uCE90\uC2DC\uB85C VRAM \uC77C\uBD80\uAC00 \uB0A8\uC744 \uC218 \uC788\uC2B5\uB2C8\uB2E4."
    ).addText(
      (text) => text.setValue(String(draft.modelIdleTimeoutSeconds)).onChange((value) => {
        draft.modelIdleTimeoutSeconds = this.nonnegativeNumber(
          value,
          draft.modelIdleTimeoutSeconds
        );
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Python \uC2E4\uD589 \uD30C\uC77C").setDesc("\uC804\uC6A9 venv\uC758 python.exe\uB97C \uAD8C\uC7A5\uD569\uB2C8\uB2E4.").addText(
      (text) => text.setValue(draft.pythonExecutable).setPlaceholder("python").onChange((value) => {
        draft.pythonExecutable = value.trim() || "python";
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Python \uBC31\uC5D4\uB4DC").setDesc(
      "BRAT \uC124\uCE58\uB294 main.js/manifest/styles.css\uB9CC \uB123\uC73C\uBBC0\uB85C, \uBC31\uC5D4\uB4DC\uB294 GitHub \uB9B4\uB9AC\uC2A4\uC5D0\uC11C \uC790\uB3D9\uC73C\uB85C \uBC1B\uC2B5\uB2C8\uB2E4. \uC774 \uBC84\uD2BC\uC73C\uB85C \uB2E4\uC2DC \uBC1B\uAC70\uB098 \uBC84\uC804\uC744 \uB9DE\uCDA5\uB2C8\uB2E4."
    ).addButton(
      (button) => button.setButtonText("\uBC31\uC5D4\uB4DC \uC124\uCE58/\uBCF5\uAD6C").onClick(async () => {
        try {
          await this.owner.provisionBackend();
        } catch (error) {
          this.showError(error);
        }
      })
    );
    containerEl.createEl("h3", { text: "AI Vault \uB2F5\uBCC0" });
    new import_obsidian2.Setting(containerEl).setName("\uB2F5\uBCC0 provider").setDesc(
      "\uAC80\uC0C9 \uADFC\uAC70\uB9CC provider\uC5D0 \uC804\uB2EC\uD569\uB2C8\uB2E4. API key\uB294 \uD50C\uB7EC\uADF8\uC778\uC5D0 \uC800\uC7A5\uD558\uC9C0 \uC54A\uACE0 sidecar\uAC00 \uD658\uACBD\uBCC0\uC218\uC5D0\uC11C \uC77D\uC2B5\uB2C8\uB2E4."
    ).addDropdown((dropdown) => {
      for (const [id, provider] of Object.entries(LLM_PROVIDER_DEFAULTS))
        dropdown.addOption(id, provider.name);
      dropdown.setValue(draft.answerProvider).onChange((value) => {
        const previousProvider = draft.answerProvider;
        this.providerModelSelections[previousProvider] = draft.answerModel;
        draft.answerProvider = value;
        draft.answerModel = chooseProviderModel(
          this.providerModels[draft.answerProvider] || [],
          this.providerModelSelections[draft.answerProvider],
          ""
        );
        this.providerModelSelections[draft.answerProvider] = draft.answerModel;
        this.display();
      });
    });
    const answerProvider = LLM_PROVIDER_DEFAULTS[draft.answerProvider];
    const savedApiKey = this.owner.getProviderApiKey(draft.answerProvider);
    let apiKeyInput = null;
    new import_obsidian2.Setting(containerEl).setName("API \uD0A4").setDesc(
      savedApiKey ? "Obsidian \uBCF4\uC548 \uC800\uC7A5\uC18C\uC5D0 \uC800\uC7A5\uB428" : "Obsidian \uBCF4\uC548 \uC800\uC7A5\uC18C\uC5D0 \uC800\uC7A5\uD569\uB2C8\uB2E4"
    ).addText((text) => {
      text.inputEl.type = "password";
      text.setPlaceholder(
        savedApiKey ? "\uC800\uC7A5\uB41C \uD0A4\uB97C \uAD50\uCCB4\uD558\uB824\uBA74 \uC785\uB825" : `${answerProvider.env} \uC785\uB825`
      );
      apiKeyInput = text.inputEl;
      return text;
    }).addButton(
      (button) => button.setButtonText("\uC800\uC7A5").setCta().onClick(async () => {
        const value = apiKeyInput?.value.trim() || "";
        if (!value) {
          new import_obsidian2.Notice("\uC800\uC7A5\uD560 API \uD0A4\uB97C \uC785\uB825\uD574 \uC8FC\uC138\uC694.");
          return;
        }
        try {
          await this.owner.saveProviderApiKey(draft.answerProvider, value);
          new import_obsidian2.Notice(`${answerProvider.name} API \uD0A4\uB97C \uC800\uC7A5\uD588\uC2B5\uB2C8\uB2E4.`);
          this.display();
        } catch (error) {
          this.showError(error);
        }
      })
    ).addButton(
      (button) => button.setButtonText("\uC0AD\uC81C").onClick(async () => {
        try {
          await this.owner.saveProviderApiKey(draft.answerProvider, "");
          new import_obsidian2.Notice(`${answerProvider.name} API \uD0A4\uB97C \uC0AD\uC81C\uD588\uC2B5\uB2C8\uB2E4.`);
          this.display();
        } catch (error) {
          this.showError(error);
        }
      })
    );
    const fetchedModels = this.providerModels[draft.answerProvider] || [];
    let modelOptions = fetchedModels;
    if (!modelOptions.length && draft.answerModel) {
      modelOptions = [draft.answerModel];
    }
    const favorites = Array.isArray(draft.favoriteAnswerModels) ? [...draft.favoriteAnswerModels] : [];
    const modelSetting = new import_obsidian2.Setting(containerEl).setName("\uB2F5\uBCC0 \uBAA8\uB378").setDesc(
      fetchedModels.length ? `${fetchedModels.length}\uAC1C \uBAA8\uB378\uC744 \uD655\uC778\uD588\uC2B5\uB2C8\uB2E4. \uBAA8\uB378\uC744 \uD074\uB9AD\uD574 \uC120\uD0DD\uD558\uACE0, \u2605\uB85C \uC990\uACA8\uCC3E\uAE30\uB97C \uC9C0\uC815\uD558\uC138\uC694. \uC990\uACA8\uCC3E\uAE30 \uBAA8\uB378\uC740 \uBAA8\uB4E0 provider\uC5D0\uC11C \uBAA8\uC544\uC838 AI Vault Search \uD328\uB110\uC758 \uBAA8\uB378 \uC120\uD0DD\uC5D0 \uD45C\uC2DC\uB429\uB2C8\uB2E4.` : `\uBA3C\uC800 \uBAA8\uB378 \uCD5C\uC2E0\uD654\uB97C \uB20C\uB7EC \uC120\uD0DD\uC9C0\uB97C \uAC00\uC838\uC624\uC138\uC694. \uC120\uD0DD\uD558\uAE30 \uC804\uC5D0\uB294 \uBAA8\uB378\uC774 \uC9C0\uC815\uB418\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.`
    ).setClass("vault-search-model-setting");
    const modelList = modelSetting.controlEl.createDiv({
      cls: "vault-search-model-list"
    });
    const renderModelList = () => {
      modelList.empty();
      if (!modelOptions.length) {
        modelList.createEl("div", {
          cls: "vault-search-model-empty",
          text: "\uC120\uD0DD\uB41C \uBAA8\uB378\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uC704 \uBAA9\uB85D\uC5D0\uC11C \uBAA8\uB378\uC744 \uC120\uD0DD\uD558\uC138\uC694."
        });
      }
      for (const model of modelOptions) {
        const row = modelList.createDiv({ cls: "vault-search-model-row" });
        row.toggleClass("is-selected", model === draft.answerModel);
        const name = row.createEl("button", {
          cls: "vault-search-model-name",
          text: model,
          attr: { type: "button", title: model }
        });
        name.addEventListener("click", () => {
          draft.answerModel = model;
          this.providerModelSelections[draft.answerProvider] = model;
          void this.owner.setAnswerModel(draft.answerProvider, model, {
            notify: false
          });
          renderModelList();
        });
        if (model === draft.answerModel && !fetchedModels.includes(model)) {
          row.createEl("span", {
            cls: "vault-search-model-current",
            text: "(\uD604\uC7AC \uC124\uC815)"
          });
        }
        const starred = favorites.some(
          (favorite) => favorite.provider === draft.answerProvider && favorite.model === model
        );
        const star = row.createEl("button", {
          cls: "vault-search-model-star",
          text: starred ? "\u2605" : "\u2606",
          attr: {
            type: "button",
            "aria-label": starred ? "\uC990\uACA8\uCC3E\uAE30\uC5D0\uC11C \uC81C\uAC70" : "\uC990\uACA8\uCC3E\uAE30\uB85C \uC9C0\uC815",
            title: starred ? "\uC990\uACA8\uCC3E\uAE30\uC5D0\uC11C \uC81C\uAC70" : "\uC990\uACA8\uCC3E\uAE30\uB85C \uC9C0\uC815"
          }
        });
        star.toggleClass("is-favorite", starred);
        star.addEventListener("click", () => {
          const index = favorites.findIndex(
            (favorite) => favorite.provider === draft.answerProvider && favorite.model === model
          );
          if (index >= 0) favorites.splice(index, 1);
          else favorites.push({ provider: draft.answerProvider, model });
          draft.favoriteAnswerModels = favorites.map((favorite) => ({
            ...favorite
          }));
          void this.owner.toggleFavoriteModel(draft.answerProvider, model);
          renderModelList();
        });
      }
    };
    renderModelList();
    modelSetting.addButton(
      (button) => button.setButtonText("\uBAA8\uB378 \uCD5C\uC2E0\uD654").onClick(async () => {
        button.setDisabled(true);
        try {
          const models = await this.owner.fetchProviderModels(
            draft.answerProvider
          );
          this.providerModels[draft.answerProvider] = models;
          this.owner.setProviderModels(draft.answerProvider, models);
          this.providerModelSelections[draft.answerProvider] = draft.answerModel;
          new import_obsidian2.Notice(
            models.length ? `${answerProvider.name}: \uC120\uD0DD \uAC00\uB2A5\uD55C \uBAA8\uB378 ${models.length}\uAC1C\uB97C \uD655\uC778\uD588\uC2B5\uB2C8\uB2E4.` : draft.answerProvider === "openai" ? "OpenAI API\uAC00 \uC120\uD0DD \uAC00\uB2A5\uD55C \uCC44\uD305 \uBAA8\uB378\uC744 \uBC18\uD658\uD558\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4. API \uD0A4\uC758 \uBAA8\uB378 \uAD8C\uD55C\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694." : `${answerProvider.name}: \uC120\uD0DD \uAC00\uB2A5\uD55C \uBAA8\uB378\uC744 \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. API \uD0A4\uC758 \uBAA8\uB378 \uAD8C\uD55C\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694.`
          );
          this.display();
        } catch (error) {
          this.showError(error);
        } finally {
          button.setDisabled(false);
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\uB2F5\uBCC0 context \uBB38\uC790 \uC218").setDesc("8,000~32,000\uC790").addText(
      (text) => text.setValue(String(draft.answerMaxContextChars)).onChange((value) => {
        draft.answerMaxContextChars = Math.max(
          8e3,
          Math.min(
            32e3,
            this.nonnegativeNumber(value, draft.answerMaxContextChars)
          )
        );
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\uB2F5\uBCC0 \uCD9C\uB825 \uD1A0\uD070").setDesc("128~8,000 \uD1A0\uD070").addText(
      (text) => text.setValue(String(draft.answerMaxOutputTokens)).onChange((value) => {
        draft.answerMaxOutputTokens = Math.max(
          128,
          Math.min(
            8e3,
            this.nonnegativeNumber(value, draft.answerMaxOutputTokens)
          )
        );
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\uB2F5\uBCC0 timeout (\uCD08)").setDesc("provider \uC694\uCCAD timeout\uC740 \uCD5C\uB300 60\uCD08\uC785\uB2C8\uB2E4.").addText(
      (text) => text.setValue(String(draft.answerTimeoutSeconds)).onChange((value) => {
        draft.answerTimeoutSeconds = Math.max(
          5,
          Math.min(
            60,
            this.nonnegativeNumber(value, draft.answerTimeoutSeconds)
          )
        );
      })
    );
    const agent = this.owner.agentIntegration;
    new import_obsidian2.Setting(containerEl).setName("\uC5D0\uC774\uC804\uD2B8 \uD1B5\uD569").setDesc(
      "AI \uC5D0\uC774\uC804\uD2B8(Claude Code, Codex, Gemini CLI \uB4F1)\uAC00 \uC774 \uBCFC\uD2B8\uC5D0\uC11C vault-search\uB97C \uC0AC\uC6A9\uD558\uB3C4\uB85D \uC9C0\uC2DC \uD30C\uC77C\uACFC \uAC80\uC0C9 \uB798\uD37C\uB97C \uC124\uCE58\uD569\uB2C8\uB2E4. \uBCFC\uD2B8 \uB8E8\uD2B8 \uD30C\uC77C\uC740 \uBA85\uC2DC\uC801\uC73C\uB85C \uC124\uCE58\uD560 \uB54C\uB9CC \uC218\uC815\uB418\uBA70, \uAE30\uC874 \uAC80\uC0C9 \uC9C0\uC2DC\uAC00 \uC788\uC73C\uBA74 \uC790\uB3D9\uC73C\uB85C \uAC74\uB108\uB701\uB2C8\uB2E4. " + (agent ? this.agentStatusText(agent) : "\uC0C1\uD0DC \uD655\uC778 \uC911\u2026")
    ).addButton(
      (button) => button.setButtonText("\uC124\uCE58/\uAC31\uC2E0").setCta().onClick(async () => {
        try {
          const result = await this.owner.runAgentIntegrationInstall();
          new import_obsidian2.Notice(agentIntegrationNotice(result), 8e3);
          this.display();
        } catch (error) {
          this.showError(error);
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\uC784\uBCA0\uB529 \uBAA8\uB378").addDropdown((dropdown) => {
      for (const [id, profile] of Object.entries(MODEL_PROFILES))
        dropdown.addOption(id, profile.name);
      dropdown.setValue(draft.modelProfile).onChange((id) => {
        const profile = MODEL_PROFILES[id];
        draft.modelProfile = id;
        if (id !== "custom" && profile) {
          draft.modelId = profile.modelId;
          draft.queryPrefix = profile.queryPrefix;
          draft.documentPrefix = profile.documentPrefix;
        }
        this.display();
      });
    });
    new import_obsidian2.Setting(containerEl).setName("\uBAA8\uB378 ID").setDesc(
      MODEL_PROFILES[draft.modelProfile]?.note || "Sentence Transformers \uBAA8\uB378 ID"
    ).addText(
      (text) => text.setValue(draft.modelId).onChange((value) => {
        draft.modelId = value.trim();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\uC784\uBCA0\uB529 \uBC31\uC5D4\uB4DC").setDesc(
      "ONNX Runtime(\uAE30\uBCF8): \uC9C1\uC811 ONNX \uACBD\uB85C\uB85C \uC2DC\uC791\uC774 \uBE60\uB974\uACE0 \uC720\uD734 \uC2DC VRAM/RAM\uC744 \uD574\uC81C\uD569\uB2C8\uB2E4. GPU\uAC00 \uC788\uC73C\uBA74 TensorRT/CUDA\uB97C, \uC5C6\uC73C\uBA74 CPU\uB97C \uC790\uB3D9 \uC0AC\uC6A9\uD569\uB2C8\uB2E4. PyTorch: \uBC8C\uD06C \uC778\uB371\uC2F1\uC774 \uAC00\uC7A5 \uBE60\uB974\uC9C0\uB9CC \uC2DC\uC791\uC774 \uB290\uB9BD\uB2C8\uB2E4. \uBC31\uC5D4\uB4DC\uB97C \uBC14\uAFB8\uBA74 \uC2DC\uC791 \uC815\uCC45 \uAE30\uBCF8\uAC12\uB3C4 \uD568\uAED8 \uC870\uC815\uB429\uB2C8\uB2E4."
    ).addDropdown(
      (dropdown) => dropdown.addOption("onnx", "ONNX Runtime (\uAE30\uBCF8, \uAD8C\uC7A5)").addOption("pytorch", "PyTorch").setValue(draft.engine).onChange((value) => {
        const previous = draft.engine;
        draft.engine = value;
        if (draft.loadPolicy === defaultLoadPolicy(previous)) {
          draft.loadPolicy = defaultLoadPolicy(draft.engine);
        }
        this.display();
      })
    );
    containerEl.createEl("h3", { text: "\uACE0\uAE09 \uC124\uC815" });
    new import_obsidian2.Setting(containerEl).setName("\uB514\uBC14\uC774\uC2A4").setDesc(
      "\uC790\uB3D9(\uAE30\uBCF8)\uC740 GPU\uC640 \uAC80\uC99D\uB41C CUDA \uB7F0\uD0C0\uC784\uC774 \uC788\uC73C\uBA74 GPU\uB97C, \uC5C6\uC73C\uBA74 CPU\uB97C \uC0AC\uC6A9\uD569\uB2C8\uB2E4. CUDA\uB97C \uBA85\uC2DC\uD558\uBA74 \uB300\uC6A9\uB7C9 \uB7F0\uD0C0\uC784 \uB2E4\uC6B4\uB85C\uB4DC\uAC00 \uD544\uC694\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4."
    ).addDropdown(
      (dropdown) => dropdown.addOption("auto", "\uC790\uB3D9").addOption("cpu", "CPU").addOption("cuda", "CUDA").setValue(draft.device).onChange((value) => {
        draft.device = value;
      })
    );
    const caps = status.capabilities;
    if (draft.engine === "onnx" && caps && caps.derived_model_available === false) {
      new import_obsidian2.Setting(containerEl).setName("ONNX \uD30C\uC0DD \uBAA8\uB378 \uC900\uBE44").setDesc(
        caps.model_available === false ? "e5-base \uBAA8\uB378 \uC2A4\uB0C5\uC0F7\uC774 \uB85C\uCEEC\uC5D0 \uC5C6\uC2B5\uB2C8\uB2E4. \uBA3C\uC800 intfloat/multilingual-e5-base\uB97C \uBC1B\uC544 \uC8FC\uC138\uC694." : "\uB85C\uCEEC \uC2A4\uB0C5\uC0F7\uC5D0 \uD30C\uC0DD \uD480\uB9C1 \uADF8\uB798\uD504(onnx/model-pooled-normalized.onnx)\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4. \uC0DD\uC131\uC744 \uC2E4\uD589\uD558\uBA74 ONNX \uC5D4\uC9C4\uC744 \uC0AC\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4."
      ).addButton((button) => {
        button.setButtonText("\uD30C\uC0DD \uBAA8\uB378 \uC0DD\uC131").setCta();
        if (caps.model_available === false) button.setDisabled(true);
        button.onClick(async () => {
          try {
            await this.owner.provisionOnnx();
          } catch (error) {
            this.showError(error);
          }
        });
      });
    }
    const providerOptions = [["auto", "\uC790\uB3D9"]];
    if (caps?.cuda_available !== false) providerOptions.push(["cuda", "CUDA"]);
    if (caps?.tensorrt_available !== false)
      providerOptions.push(["tensorrt", "TensorRT"]);
    const providerLabels = {
      auto: "\uC790\uB3D9",
      cuda: "CUDA",
      tensorrt: "TensorRT"
    };
    const providerValue = draft.provider;
    if (!providerOptions.some(([value]) => value === providerValue)) {
      const label = providerLabels[providerValue] || providerValue;
      const rejectedByCaps = caps !== void 0 && (providerValue === "cuda" && caps.cuda_available === false || providerValue === "tensorrt" && caps.tensorrt_available === false);
      providerOptions.push([
        providerValue,
        rejectedByCaps ? `${label} (\uD604\uC7AC \uB7F0\uD0C0\uC784\uC5D0\uC11C \uC0AC\uC6A9 \uBD88\uAC00)` : label
      ]);
    }
    const supported = caps ? [caps.cuda_available && "CUDA", caps.tensorrt_available && "TensorRT"].filter(Boolean).join(", ") || "CPU\uB9CC" : "\uC11C\uBE44\uC2A4 \uC2DC\uC791 \uD6C4 \uD655\uC778";
    new import_obsidian2.Setting(containerEl).setName("ONNX \uC2E4\uD589 \uC81C\uACF5\uC790 (provider)").setDesc(
      `CUDA \uC2E4\uD589 \uC2DC\uC5D0\uB9CC \uC801\uC6A9\uB429\uB2C8\uB2E4 (device=cuda \uB610\uB294 auto\uAC00 CUDA\uB85C \uD574\uC11D\uB420 \uB54C). \uC774 \uBA38\uC2E0 \uC9C0\uC6D0: ${supported}. auto\uB294 TensorRT\uAC00 \uC124\uCE58\uB418\uC5B4 \uC788\uC73C\uBA74 \uC6B0\uC120\uD558\uACE0, \uC544\uB2C8\uBA74 CUDA\uB85C \uD3F4\uBC31\uD569\uB2C8\uB2E4.`
    ).addDropdown((dropdown) => {
      for (const [value, label] of providerOptions)
        dropdown.addOption(value, label);
      dropdown.setValue(providerValue).setDisabled(draft.engine !== "onnx" || draft.device === "cpu").onChange((value) => {
        draft.provider = value;
      });
    });
    const cudaInstalled = caps?.cuda_available === true;
    new import_obsidian2.Setting(containerEl).setName("CUDA \uB7F0\uD0C0\uC784").setDesc(
      cudaInstalled ? "CUDA \uB7F0\uD0C0\uC784\uC774 \uC124\uCE58\uB418\uC5B4 \uC0AC\uC6A9 \uAC00\uB2A5\uD569\uB2C8\uB2E4. \uC7AC\uC124\uCE58\uAC00 \uD544\uC694\uD558\uBA74 \uB7F0\uD0C0\uC784 \uD3F4\uB354\uB97C \uC815\uB9AC\uD55C \uB4A4 \uB2E4\uC2DC \uC124\uCE58\uD558\uC138\uC694." : "NVIDIA GPU\uC6A9 PyTorch\uC640 onnxruntime-gpu\uB97C \uBCC4\uB3C4 \uC124\uCE58\uD569\uB2C8\uB2E4. \uC218 GB \uB2E4\uC6B4\uB85C\uB4DC\uC640 \uBCA1\uD130 \uC7AC\uAD6C\uCD95\uC73C\uB85C \uC218 \uBD84 \uC774\uC0C1 \uAC78\uB9B4 \uC218 \uC788\uC2B5\uB2C8\uB2E4."
    ).addButton((button) => {
      button.setButtonText(
        cudaInstalled ? "CUDA \uB7F0\uD0C0\uC784 \uC124\uCE58\uB428" : "CUDA \uB7F0\uD0C0\uC784 \uC124\uCE58"
      ).setDisabled(cudaInstalled).onClick(async () => {
        try {
          await this.owner.installCudaRuntime();
        } catch (error) {
          this.showError(error);
        }
      });
    });
    new import_obsidian2.Setting(containerEl).setName("\uC784\uBCA0\uB529 \uC815\uADDC\uD654").addToggle(
      (toggle) => toggle.setValue(draft.normalizeEmbeddings).onChange((value) => {
        draft.normalizeEmbeddings = value;
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Query prefix").addText(
      (text) => text.setValue(draft.queryPrefix).onChange((value) => {
        draft.queryPrefix = value;
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Document prefix").addText(
      (text) => text.setValue(draft.documentPrefix).onChange((value) => {
        draft.documentPrefix = value;
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Include globs").setDesc("\uBCFC\uD2B8 \uC0C1\uB300 \uACBD\uB85C, \uD55C \uC904\uC5D0 \uD558\uB098").setClass("vault-search-textarea").addTextArea((area) => {
      area.setValue(draft.includeGlobs.join("\n"));
      area.inputEl.rows = 7;
      area.onChange((value) => {
        draft.includeGlobs = this.lines(value);
      });
    });
    new import_obsidian2.Setting(containerEl).setName("Exclude globs").setDesc("\uBCFC\uD2B8 \uC0C1\uB300 \uACBD\uB85C, \uD55C \uC904\uC5D0 \uD558\uB098").setClass("vault-search-textarea").addTextArea((area) => {
      area.setValue(draft.excludeGlobs.join("\n"));
      area.inputEl.rows = 7;
      area.onChange((value) => {
        draft.excludeGlobs = this.lines(value);
      });
    });
    new import_obsidian2.Setting(containerEl).setName("\uC704\uD0A4 \uD3F4\uB354").setDesc(
      "\uD0C0\uC784\uB77C\uC778/\uAD00\uACC4 \uAC80\uC0C9\uC5D0\uC11C sources \uCC38\uC870\uB97C \uB530\uB77C\uAC00\uB294 \uC704\uD0A4 \uD3F4\uB354 \uBAA9\uB85D\uC785\uB2C8\uB2E4 (\uBCFC\uD2B8 \uC0C1\uB300 \uACBD\uB85C, \uD55C \uC904\uC5D0 \uD558\uB098). \uAE30\uBCF8\uAC12(5_Wiki/\u2026)\uC740 K_Notes \uBC30\uCE58\uC785\uB2C8\uB2E4. \uC704\uD0A4\uAC00 \uB2E4\uB978 \uD3F4\uB354\uC5D0 \uC788\uC73C\uBA74 \uC5EC\uAE30\uC11C \uC9C0\uC815\uD558\uACE0, \uC704\uD0A4\uAC00 \uC5C6\uC73C\uBA74 \uBE44\uC6CC \uB450\uBA74 \uD655\uC7A5\uC774 \uB3D9\uC791\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4."
    ).setClass("vault-search-textarea").addTextArea((area) => {
      area.setValue(draft.wikiFolders.join("\n"));
      area.inputEl.rows = 4;
      area.onChange((value) => {
        draft.wikiFolders = this.lines(value);
      });
    });
    new import_obsidian2.Setting(containerEl).setName("\uC778\uB371\uC2A4 \uAD00\uB9AC").setDesc(
      "\uC124\uC815 \uC801\uC6A9 \uD6C4 \uBC94\uC704\uB97C \uD655\uC778\uD558\uC138\uC694. \uC7AC\uAD6C\uCD95\uC740 \uC784\uC2DC \uD30C\uC77C \uAC80\uC99D \uD6C4 \uC6D0\uC790\uC801\uC73C\uB85C \uAD50\uCCB4\uB429\uB2C8\uB2E4."
    ).addButton(
      (button) => button.setButtonText("\uBC94\uC704 \uBBF8\uB9AC\uBCF4\uAE30").onClick(async () => {
        try {
          const result = await this.owner.previewScope();
          new import_obsidian2.Notice(`\uAC80\uC0C9 \uB300\uC0C1: ${result.count}\uAC1C \uD30C\uC77C`);
        } catch (error) {
          this.showError(error);
        }
      })
    ).addButton(
      (button) => button.setButtonText("\uC815\uBC00 \uB300\uC870").onClick(async () => {
        try {
          await this.owner.reconcile("strict");
        } catch (error) {
          this.showError(error);
        }
      })
    ).addButton(
      (button) => button.setButtonText("\uBCA1\uD130 \uC7AC\uAD6C\uCD95").onClick(async () => {
        try {
          await this.owner.rebuildVectors();
        } catch (error) {
          this.showError(error);
        }
      })
    ).addButton(
      (button) => button.setButtonText("\uC804\uCCB4 \uC7AC\uAD6C\uCD95").setWarning().onClick(async () => {
        try {
          await this.owner.rebuildAll();
        } catch (error) {
          this.showError(error);
        }
      })
    );
    this.numericFields(
      "\uCCAD\uD06C \uD06C\uAE30 / \uC624\uBC84\uB7A9",
      "\uAC12\uC744 \uBCC0\uACBD\uD558\uBA74 \uC804\uCCB4 \uC778\uB371\uC2A4 \uC7AC\uAD6C\uCD95\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.",
      [
        {
          label: "\uD06C\uAE30",
          value: draft.chunkChars,
          set: (v) => {
            draft.chunkChars = v;
          }
        },
        {
          label: "\uC624\uBC84\uB7A9",
          value: draft.chunkOverlap,
          allowZero: true,
          set: (v) => {
            draft.chunkOverlap = v;
          }
        }
      ]
    );
    new import_obsidian2.Setting(containerEl).setName("\uCCAD\uD0B9 \uC804\uB7B5").setDesc(
      "Markdown \uAD6C\uC870 \uC778\uC2DD \uC804\uB7B5\uC744 \uD3EC\uD568\uD574 \uBCC0\uACBD \uC2DC \uC804\uCCB4 \uC778\uB371\uC2A4 \uC7AC\uAD6C\uCD95\uC774 \uD544\uC694\uD569\uB2C8\uB2E4."
    ).addDropdown(
      (dropdown) => dropdown.addOption("paragraph-v1", "\uBB38\uB2E8 \uAE30\uBC18 (\uAE30\uBCF8\uAC12)").addOption("markdown-v2", "Markdown \uAD6C\uC870 \uC778\uC2DD").setValue(draft.chunkingStrategy).onChange((value) => {
        draft.chunkingStrategy = value;
        this.display();
      })
    );
    this.numericFields(
      "BM25 / \uBCA1\uD130 / \uCD5C\uC885 \uD6C4\uBCF4 / RRF k",
      "\uAC80\uC0C9\uC774 '\uD6C4\uBCF4\uB97C \uB113\uAC8C \uBAA8\uC544 \uC735\uD569\uD55C \uB4A4 \uCD5C\uC885 \uACB0\uACFC\uB9CC \uBC18\uD658'\uD558\uB294 \uB108\uBE44\uB97C \uC870\uC815\uD569\uB2C8\uB2E4. \uAE30\uBCF8\uAC12 80 / 80 / 40\uC740 K_Notes \uACE8\uB4DC\uC14B \uAE30\uC900 recall@40 0.856\uC73C\uB85C \uCE21\uC815\uD574 \uC815\uD55C \uAC12\uC785\uB2C8\uB2E4.",
      [
        {
          label: "BM25",
          value: draft.bm25TopK,
          set: (v) => {
            draft.bm25TopK = v;
          }
        },
        {
          label: "\uBCA1\uD130",
          value: draft.vectorTopK,
          set: (v) => {
            draft.vectorTopK = v;
          }
        },
        {
          label: "\uCD5C\uC885",
          value: draft.finalTopK,
          set: (v) => {
            draft.finalTopK = v;
          }
        },
        {
          label: "RRF k",
          value: draft.rrfK,
          set: (v) => {
            draft.rrfK = v;
          }
        }
      ]
    );
    containerEl.createEl("div", {
      cls: "vault-search-setting-hint",
      text: "\u2022 bm25TopK: \uD0A4\uC6CC\uB4DC(BM25)\uB85C \uBF51\uB294 \uD6C4\uBCF4 \uCCAD\uD06C \uC218. \uB113\uD788\uBA74 \uC815\uD655\uD55C \uB2E8\uC5B4\uAC00 \uD769\uC5B4\uC9C4 \uD30C\uC77C\uB3C4 \uB193\uCE58\uC9C0 \uC54A\uC9C0\uB9CC, \uC7A1\uC74C\uC774 \uB298 \uC218 \uC788\uC2B5\uB2C8\uB2E4.\n\u2022 vectorTopK: \uC758\uBBF8(\uC784\uBCA0\uB529) \uC720\uC0AC\uB3C4\uB85C \uBF51\uB294 \uD6C4\uBCF4 \uCCAD\uD06C \uC218. \uB113\uD788\uBA74 \uD45C\uD604\uC774 \uB2EC\uB77C\uB3C4 \uAD00\uB828\uB41C \uD30C\uC77C\uC774 \uD68C\uC218\uB429\uB2C8\uB2E4.\n\u2022 finalTopK: \uCD5C\uC885 \uBC18\uD658 \uACB0\uACFC \uC218. \uC5D0\uC774\uC804\uD2B8\uAC00 \uB113\uAC8C \uC870\uC0AC\uD560 \uB54C\uB294 40\uAC1C \uC815\uB3C4\uAC00 \uC801\uB2F9\uD569\uB2C8\uB2E4.\n\u2022 rrfK: \uC5EC\uB7EC \uCC44\uB110 \uACB0\uACFC\uB97C \uC735\uD569\uD560 \uB54C \uC21C\uC704 \uC810\uC218\uB97C \uD3C9\uD0C4\uD654\uD558\uB294 \uC0C1\uC218\uC785\uB2C8\uB2E4. \uACB0\uACFC\uAC00 \uD55C \uCC44\uB110\uC5D0 \uCE58\uC6B0\uCE58\uBA74 \uC774 \uAC12\uC744 \uC904\uC5EC \uBCF4\uC138\uC694.\n\uBC14\uAFB8\uBA74 \uC2E4\uD589 \uC911 \uC11C\uBE44\uC2A4\uC5D0 \uC989\uC2DC \uBC18\uC601\uB418\uBA70, \uACB0\uACFC\uAC00 \uC774\uC0C1\uD558\uBA74 \uAE30\uBCF8\uAC12\uC73C\uB85C \uB418\uB3CC\uB9AC\uBA74 \uB429\uB2C8\uB2E4."
    });
    this.numericFields(
      "\uAC80\uC0C9 \uB2E4\uC591\uC131 / \uC81C\uBAA9 \uAC00\uC911\uCE58",
      "\uD30C\uC77C\uB2F9 \uCD5C\uB300 \uCCAD\uD06C \uC218\uC640 \uD30C\uC77C\uBA85\xB7\uACBD\uB85C\xB7\uD5E4\uB529 RRF \uAC00\uC911\uCE58\uC785\uB2C8\uB2E4. \uAE30\uBCF8\uAC12\uC740 1 / 1.0\uC785\uB2C8\uB2E4.",
      [
        {
          label: "\uD30C\uC77C\uB2F9 \uCCAD\uD06C",
          value: draft.maxChunksPerFile,
          set: (v) => {
            draft.maxChunksPerFile = v;
          }
        },
        {
          label: "\uC81C\uBAA9 \uAC00\uC911\uCE58",
          value: draft.titleRrfWeight,
          allowZero: true,
          set: (v) => {
            draft.titleRrfWeight = v;
          }
        }
      ]
    );
    containerEl.createEl("div", {
      cls: "vault-search-setting-hint",
      text: "\u2022 maxChunksPerFile: \uD55C \uD30C\uC77C\uC774 \uCD5C\uC885 \uACB0\uACFC\uC5D0\uC11C \uCC28\uC9C0\uD560 \uC218 \uC788\uB294 \uCCAD\uD06C \uC218. 1\uC774\uBA74 \uAC01 \uD30C\uC77C\uC740 \uACB0\uACFC 1\uAC1C\uB85C \uC81C\uD55C\uB418\uC5B4 \uB2E4\uB978 \uD30C\uC77C\uB3C4 \uBCFC \uC218 \uC788\uC2B5\uB2C8\uB2E4. \uD55C \uD30C\uC77C\uC758 \uC5EC\uB7EC \uAD6C\uC808\uC744 \uBCF4\uB824\uBA74 \uB298\uB824 \uBCF4\uC138\uC694.\n\u2022 titleRrfWeight: \uD30C\uC77C\uBA85\xB7\uACBD\uB85C\xB7\uD5E4\uB529 \uB9E4\uCE58\uAC00 \uACB0\uACFC \uC21C\uC704\uC5D0 \uBBF8\uCE58\uB294 \uAC00\uC911\uCE58. \uD30C\uC77C \uC81C\uBAA9\uC744 \uC911\uC694\uD558\uAC8C \uC5EC\uAE30\uB824\uBA74 \uC62C\uB9AC\uC138\uC694."
    });
    new import_obsidian2.Setting(containerEl).setName("\uC811\uB450\uC0AC \uAC80\uC0C9 \uD3F4\uBC31").setDesc(
      "\uC815\uD655 BM25 \uACB0\uACFC\uAC00 \uC5C6\uC744 \uB54C \uD1A0\uD070 \uC811\uB450\uC0AC \uAC80\uC0C9\uC73C\uB85C \uD55C \uBC88 \uB354 \uCC3E\uC2B5\uB2C8\uB2E4."
    ).addToggle(
      (toggle) => toggle.setValue(draft.prefixFallback).onChange((value) => {
        draft.prefixFallback = value;
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\uB3D9\uAE30\uD654 debounce (ms)").addText(
      (text) => text.setValue(String(draft.syncDebounceMs)).onChange((value) => {
        draft.syncDebounceMs = this.positiveNumber(value, draft.syncDebounceMs);
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\uC790\uB3D9 \uC99D\uBD84 \uB3D9\uAE30\uD654").addToggle(
      (toggle) => toggle.setValue(draft.autoSync).onChange((value) => {
        draft.autoSync = value;
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\uC2DC\uC791 \uC2DC \uC804\uCCB4 \uB300\uC870").addToggle(
      (toggle) => toggle.setValue(draft.startupReconcile).onChange((value) => {
        draft.startupReconcile = value;
      })
    );
    this.renderTabs();
  }
  renderTabs() {
    const root = this.containerEl;
    const rendered = Array.from(root.children);
    root.empty();
    root.addClass("vault-search-settings");
    const tabs = root.createDiv({ cls: "vault-search-settings-tabs" });
    const panels = {
      general: root.createDiv({ cls: "vault-search-settings-panel" }),
      answer: root.createDiv({ cls: "vault-search-settings-panel" }),
      search: root.createDiv({ cls: "vault-search-settings-panel" })
    };
    const labels = {
      general: "\uC77C\uBC18",
      answer: "AI \uB2F5\uBCC0",
      search: "\uAC80\uC0C9\xB7\uB7F0\uD0C0\uC784"
    };
    const buttons = /* @__PURE__ */ new Map();
    const updateActive = () => {
      for (const tab of Object.keys(panels)) {
        panels[tab].toggleClass("is-active", tab === this.activeTab);
        buttons.get(tab)?.toggleClass("is-active", tab === this.activeTab);
      }
    };
    for (const tab of Object.keys(labels)) {
      const button = tabs.createEl("button", {
        text: labels[tab],
        cls: "vault-search-settings-tab",
        attr: { type: "button" }
      });
      button.addEventListener("click", () => {
        this.activeTab = tab;
        updateActive();
      });
      buttons.set(tab, button);
    }
    let panel = "general";
    const searchSettingNames = /* @__PURE__ */ new Set([
      "\uC5D0\uC774\uC804\uD2B8 \uD1B5\uD569",
      "\uC784\uBCA0\uB529 \uBAA8\uB378",
      "\uBAA8\uB378 ID",
      "\uC784\uBCA0\uB529 \uBC31\uC5D4\uB4DC",
      "\uC778\uB371\uC2A4 \uAD00\uB9AC",
      "\uCCAD\uD06C \uD06C\uAE30 / \uC624\uBC84\uB7A9",
      "\uCCAD\uD0B9 \uC804\uB7B5",
      "BM25 / \uBCA1\uD130 / \uCD5C\uC885 \uD6C4\uBCF4 / RRF k",
      "\uAC80\uC0C9 \uB2E4\uC591\uC131 / \uC81C\uBAA9 \uAC00\uC911\uCE58",
      "\uC811\uB450\uC0AC \uAC80\uC0C9 \uD3F4\uBC31",
      "\uB3D9\uAE30\uD654 debounce (ms)",
      "\uC790\uB3D9 \uC99D\uBD84 \uB3D9\uAE30\uD654",
      "\uC2DC\uC791 \uC2DC \uC804\uCCB4 \uB300\uC870"
    ]);
    for (const child of rendered) {
      const element = child;
      if (element.tagName === "H3") {
        if (element.textContent?.includes("AI Vault")) panel = "answer";
        if (element.textContent?.includes("\uACE0\uAE09")) panel = "search";
      }
      const settingName = element.querySelector(".setting-item-name")?.textContent?.trim();
      if (panel === "answer" && settingName && searchSettingNames.has(settingName)) {
        panel = "search";
      }
      panels[panel].appendChild(element);
    }
    updateActive();
  }
  /** Render a numeric row as labeled horizontal fields (label above each
   *  input) laid out BELOW the setting name/description across the full width,
   *  instead of squeezing several fields into the right control column (which
   *  runs out of space for 4+ fields). */
  numericFields(name, desc, fields) {
    const setting = new import_obsidian2.Setting(this.containerEl).setName(name).setDesc(desc).setClass("vault-search-fields-below");
    const control = setting.controlEl;
    control.addClass("vault-search-num-fields");
    for (const field of fields) {
      const group = control.createDiv({ cls: "vault-search-num-field" });
      group.createEl("span", {
        text: field.label,
        cls: "vault-search-num-field-label"
      });
      const input = group.createEl("input", {
        type: "text",
        cls: "vault-search-num-field-input",
        value: String(field.value)
      });
      input.addEventListener("input", () => {
        const parsed = Number(input.value);
        const valid = Number.isFinite(parsed) && (field.allowZero ? parsed >= 0 : parsed > 0);
        if (valid) field.set(parsed);
      });
    }
  }
  lines(value) {
    return value.split(/\r?\n/).map((line) => line.trim().replace(/\\/g, "/")).filter(Boolean);
  }
  /** Status line for the ONNX execution provider. Shows the *effective*
   *  provider (the EP the loaded session was actually built with) when the
   *  model is loaded, and the expected resolution before load, so the display
   *  reflects reality rather than only the configured value. */
  providerStatusLine(status) {
    const effective = status.effective_provider;
    const shown = effective || status.expected_provider;
    if (!shown) return "";
    const configNote = status.provider && status.provider !== "auto" ? ` (\uC124\uC815: ${this.providerLabel(status.provider)})` : "";
    return `\uC2E4\uD589 \uC81C\uACF5\uC790: ${this.providerLabel(shown)}${configNote}${effective ? "" : " (\uB85C\uB4DC \uC804 \uC608\uC0C1)"}`;
  }
  providerLabel(provider) {
    switch (provider) {
      case "TensorrtExecutionProvider":
      case "tensorrt":
        return "TensorRT";
      case "CUDAExecutionProvider":
      case "cuda":
        return "CUDA";
      case "CPUExecutionProvider":
      case "cpu":
        return "CPU";
      case "auto":
        return "\uC790\uB3D9";
      default:
        return provider || "-";
    }
  }
  agentStatusText(agent) {
    const agents = agent.agentsFile === "absent" ? "AGENTS.md: \uC5C6\uC74C" : agent.agentsFile === "managed" ? "AGENTS.md: \uAD00\uB9AC \uBE14\uB85D \uC788\uC74C" : agent.agentsFile === "conflict" ? "AGENTS.md: \uAE30\uC874 \uAC80\uC0C9 \uC9C0\uC2DC \uC788\uC74C (\uC790\uB3D9 \uD1B5\uD569 \uC548 \uD568)" : "AGENTS.md: \uAE30\uC874 \uD30C\uC77C \uC788\uC74C";
    const claude = agent.claudeFile === "absent" ? "CLAUDE.md: \uC5C6\uC74C" : agent.claudeFile === "managed" ? "CLAUDE.md: \uAD00\uB9AC \uBE14\uB85D \uC788\uC74C" : agent.claudeFile === "conflict" ? "CLAUDE.md: \uAE30\uC874 \uAC80\uC0C9 \uC9C0\uC2DC \uC788\uC74C (\uC790\uB3D9 \uD1B5\uD569 \uC548 \uD568)" : "CLAUDE.md: \uAE30\uC874 \uD30C\uC77C \uC788\uC74C";
    const wrapper = agent.wrapper ? "\uB798\uD37C: \uC124\uCE58\uB428" : "\uB798\uD37C: \uC5C6\uC74C";
    const skill = agent.skill === "absent" ? "\uC2A4\uD0AC(Claude): \uC5C6\uC74C" : agent.skill === "managed" ? "\uC2A4\uD0AC(Claude): \uAD00\uB9AC\uB428" : "\uC2A4\uD0AC(Claude): \uAE30\uC874 \uD30C\uC77C";
    const agentsSkill = agent.agentsSkill ? "\uC2A4\uD0AC(Codex/Antigravity/OpenCode): \uC124\uCE58\uB428" : "\uC2A4\uD0AC(Codex/Antigravity/OpenCode): \uC5C6\uC74C";
    return `\uD604\uC7AC \uC0C1\uD0DC \u2014 ${agents} / ${claude} / ${wrapper} / ${skill} / ${agentsSkill}`;
  }
  positiveNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
  nonnegativeNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }
  showError(error) {
    new import_obsidian2.Notice(
      `Vault Search \uC624\uB958: ${error instanceof Error ? error.message : String(error)}`,
      8e3
    );
    this.display();
  }
};

// src/vault-event-queue.ts
var VaultEventQueue = class {
  constructor(debounceMs, flushCallback, maxBatchSize = 200) {
    this.debounceMs = debounceMs;
    this.flushCallback = flushCallback;
    this.maxBatchSize = maxBatchSize;
  }
  changed = /* @__PURE__ */ new Set();
  deleted = /* @__PURE__ */ new Set();
  timer = null;
  flushing = false;
  markChanged(path5) {
    if (!path5.toLowerCase().endsWith(".md")) return;
    this.deleted.delete(path5);
    this.changed.add(path5);
    this.schedule();
  }
  markDeleted(path5) {
    if (!path5.toLowerCase().endsWith(".md")) return;
    this.changed.delete(path5);
    this.deleted.add(path5);
    this.schedule();
  }
  async flush() {
    if (this.flushing) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.changed.size === 0 && this.deleted.size === 0) return;
    this.flushing = true;
    const changed = [...this.changed].slice(0, this.maxBatchSize);
    const remaining = Math.max(0, this.maxBatchSize - changed.length);
    const deleted = [...this.deleted].slice(0, remaining);
    for (const path5 of changed) this.changed.delete(path5);
    for (const path5 of deleted) this.deleted.delete(path5);
    try {
      const accepted = await this.flushCallback(changed, deleted);
      if (!accepted) {
        for (const path5 of changed) this.changed.add(path5);
        for (const path5 of deleted) this.deleted.add(path5);
      }
    } catch {
      for (const path5 of changed) this.changed.add(path5);
      for (const path5 of deleted) this.deleted.add(path5);
    } finally {
      this.flushing = false;
      if (this.changed.size || this.deleted.size) this.schedule();
    }
  }
  clear() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.changed.clear();
    this.deleted.clear();
  }
  schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), Math.max(100, this.debounceMs()));
  }
};

// src/search-modal.ts
var import_obsidian3 = require("obsidian");

// src/search-session.ts
function selectedTextQuery(editor) {
  return editor.getSelection();
}
var SearchSession = class {
  constructor(search, stateChanged, debounceMs = 250) {
    this.search = search;
    this.stateChanged = stateChanged;
    this.debounceMs = debounceMs;
  }
  timer = null;
  generation = 0;
  setQuery(value) {
    const query = value.trim();
    const generation = ++this.generation;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (query.length < 2) {
      this.stateChanged({ kind: "idle" });
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.execute(query, generation);
    }, this.debounceMs);
  }
  dispose() {
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  async execute(query, generation) {
    this.stateChanged({ kind: "loading" });
    try {
      const results = await this.search(query);
      if (generation !== this.generation) return;
      this.stateChanged({ kind: "results", results });
    } catch (error) {
      if (generation !== this.generation) return;
      this.stateChanged({
        kind: "unavailable",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
};

// src/search-result-view.ts
function resultLocation(result) {
  return { path: result.file_path, line: Math.max(1, result.start_line ?? 1) };
}
var SearchResultView = class {
  constructor(containerEl, openResult) {
    this.containerEl = containerEl;
    this.openResult = openResult;
  }
  render(results) {
    this.containerEl.empty();
    if (results.length === 0) {
      this.containerEl.createDiv({ cls: "vault-search-empty", text: "\uAC80\uC0C9 \uACB0\uACFC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4." });
      return;
    }
    for (const result of results) {
      const location = resultLocation(result);
      const item = this.containerEl.createEl("button", { cls: "vault-search-result" });
      const header = item.createDiv({ cls: "vault-search-result-header" });
      header.createSpan({
        cls: "vault-search-result-file",
        text: result.file_path.split("/").pop()?.replace(/\.md$/i, "") || result.file_path
      });
      const badges = header.createSpan({ cls: "vault-search-result-badges" });
      for (const channel of result.channels ?? []) {
        badges.createSpan({ cls: "vault-search-channel", text: channel });
      }
      const heading = result.heading_path?.filter(Boolean).join(" \u203A ");
      if (heading) item.createDiv({ cls: "vault-search-result-heading", text: heading });
      item.createDiv({ cls: "vault-search-result-snippet", text: result.content.replace(/\s+/g, " ").trim() });
      item.addEventListener("click", () => void this.openResult(location));
    }
  }
};

// src/search-api.ts
var SearchApi = class {
  constructor(owner) {
    this.owner = owner;
  }
  async search(query) {
    await this.owner.ensureSearchStarted();
    try {
      return await this.runSearch(query);
    } catch (error) {
      if (error instanceof BackendCallError && error.code === "MODEL_LOADING") {
        await this.owner.ensureSearchStarted();
        return await this.runSearch(query);
      }
      throw error;
    }
  }
  async runSearch(query) {
    const response = await this.owner.backend.call(
      "search",
      { query, verbose: true },
      3e4
    );
    return response.results;
  }
};

// src/search-modal.ts
var VaultSearchModal = class extends import_obsidian3.Modal {
  constructor(owner, initialQuery = "") {
    super(owner.app);
    this.owner = owner;
    this.initialQuery = initialQuery;
  }
  inputEl;
  statusEl;
  resultsEl;
  resultView;
  session;
  searchApi;
  onOpen() {
    this.modalEl.addClass("vault-search-modal");
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "Vault Search" });
    this.inputEl = this.contentEl.createEl("input", {
      cls: "vault-search-input",
      attr: { type: "search", placeholder: "\uBCFC\uD2B8 \uAC80\uC0C9", "aria-label": "Vault Search query" }
    });
    this.statusEl = this.contentEl.createDiv({ cls: "vault-search-modal-status" });
    this.resultsEl = this.contentEl.createDiv({ cls: "vault-search-results" });
    this.resultView = new SearchResultView(
      this.resultsEl,
      (location) => this.owner.openSearchResult(location)
    );
    this.searchApi = new SearchApi(this.owner);
    this.session = new SearchSession((query) => this.searchApi.search(query), (state) => this.renderState(state));
    this.inputEl.addEventListener("input", () => this.session.setQuery(this.inputEl.value));
    this.inputEl.value = this.initialQuery;
    this.renderBackendStatus(this.owner.backend.status);
    this.session.setQuery(this.initialQuery);
    this.inputEl.focus();
    this.inputEl.setSelectionRange(this.inputEl.value.length, this.inputEl.value.length);
  }
  onClose() {
    this.session?.dispose();
    this.contentEl.empty();
    this.owner.searchModalClosed(this);
  }
  updateBackendStatus(status) {
    if (this.statusEl) this.renderBackendStatus(status);
  }
  renderState(state) {
    if (state.kind === "idle") {
      this.resultsEl.empty();
      return;
    }
    if (state.kind === "loading") {
      this.resultsEl.empty();
      this.resultsEl.createDiv({ cls: "vault-search-empty", text: "\uAC80\uC0C9 \uC911\u2026" });
      return;
    }
    if (state.kind === "results") {
      this.resultView.render(state.results);
      return;
    }
    this.resultsEl.empty();
    const unavailable = this.resultsEl.createDiv({ cls: "vault-search-unavailable" });
    unavailable.createDiv({ text: `\uAC80\uC0C9 \uC11C\uBE44\uC2A4\uB97C \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4: ${state.message}` });
    const button = unavailable.createEl("button", { text: "\uC124\uC815 \uC5F4\uAE30" });
    button.addEventListener("click", () => this.owner.openSearchSettings());
  }
  renderBackendStatus(status) {
    this.statusEl.removeClass("vault-search-error");
    if (status.state === "idle") {
      this.statusEl.setText("\uBAA8\uB378 \uB300\uAE30 \uC911 \xB7 \uAC80\uC0C9 \uC2DC \uBAA8\uB378\uC744 \uB85C\uB4DC\uD569\uB2C8\uB2E4.");
    } else if (status.state === "loading_model" || status.state === "starting") {
      this.statusEl.setText("\uAC80\uC0C9 \uBAA8\uB378\uC744 \uB85C\uB4DC\uD558\uACE0 \uC788\uC2B5\uB2C8\uB2E4\u2026");
    } else if (status.state === "error") {
      this.statusEl.setText(status.error || "\uAC80\uC0C9 \uC11C\uBE44\uC2A4\uB97C \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
      this.statusEl.addClass("vault-search-error");
    } else if (status.state === "stopped") {
      this.statusEl.setText("\uAC80\uC0C9 \uC11C\uBE44\uC2A4\uAC00 \uC911\uC9C0\uB418\uC5B4 \uC788\uC2B5\uB2C8\uB2E4.");
    } else {
      this.statusEl.setText("");
    }
  }
};

// src/runtime-install-modal.ts
var import_obsidian4 = require("obsidian");
var RuntimeInstallModal = class extends import_obsidian4.Modal {
  constructor(app, explicitCuda, resolveChoice) {
    super(app);
    this.explicitCuda = explicitCuda;
    this.resolveChoice = resolveChoice;
  }
  settled = false;
  onOpen() {
    this.titleEl.setText("CUDA \uAC80\uC0C9 \uB7F0\uD0C0\uC784 \uC124\uCE58");
    this.contentEl.createEl("p", { text: "NVIDIA GPU\uAC00 \uAC10\uC9C0\uB410\uC9C0\uB9CC CUDA\uC6A9 PyTorch \uB7F0\uD0C0\uC784\uC774 \uC124\uCE58\uB418\uC5B4 \uC788\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4." });
    this.contentEl.createEl("p", { text: "\uCD5C\uCD08 \uC124\uCE58\uB294 \uC218 GB\uB97C \uB2E4\uC6B4\uB85C\uB4DC\uD558\uBBC0\uB85C \uB124\uD2B8\uC6CC\uD06C\uC640 PC \uC131\uB2A5\uC5D0 \uB530\uB77C \uC218 \uBD84 \uC774\uC0C1 \uAC78\uB9B4 \uC218 \uC788\uC2B5\uB2C8\uB2E4. \uC124\uCE58 \uD6C4 \uBCA1\uD130 \uC778\uB371\uC2A4\uB97C \uB2E4\uC2DC \uAD6C\uCD95\uD569\uB2C8\uB2E4." });
    if (this.explicitCuda) this.contentEl.createEl("p", { text: "CUDA\uB97C \uBA85\uC2DC\uC801\uC73C\uB85C \uC120\uD0DD\uD588\uC73C\uBBC0\uB85C \uC124\uCE58\uD558\uC9C0 \uC54A\uC73C\uBA74 \uC124\uC815\uC744 \uC801\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." });
    new import_obsidian4.Setting(this.contentEl).addButton((button) => button.setButtonText("\uB098\uC911\uC5D0").onClick(() => this.finish(false))).addButton((button) => button.setButtonText("\uC124\uCE58").setCta().onClick(() => this.finish(true)));
  }
  onClose() {
    this.contentEl.empty();
    if (!this.settled) {
      this.settled = true;
      this.resolveChoice(false);
    }
  }
  finish(install) {
    if (this.settled) return;
    this.settled = true;
    this.close();
    this.resolveChoice(install);
  }
};
function confirmRuntimeInstall(app, explicitCuda) {
  return new Promise((resolve3) => new RuntimeInstallModal(app, explicitCuda, resolve3).open());
}

// src/runtime-selection.ts
function selectRuntime(device, current, cpu, cuda, hasNvidiaGpu) {
  if (device === "cpu") {
    const selected2 = cpu || current;
    return selected2 ? { kind: "selected", runtime: selected2 } : { kind: "error", message: "\uC0AC\uC6A9 \uAC00\uB2A5\uD55C CPU \uAC80\uC0C9 \uB7F0\uD0C0\uC784\uC774 \uC5C6\uC2B5\uB2C8\uB2E4." };
  }
  if (current?.cudaAvailable) return { kind: "selected", runtime: current };
  if (cuda?.cudaAvailable) return { kind: "selected", runtime: cuda };
  if (!hasNvidiaGpu) {
    if (device === "cuda") {
      return { kind: "error", message: "NVIDIA GPU \uB610\uB294 \uB4DC\uB77C\uC774\uBC84\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." };
    }
    const selected2 = cpu || current;
    return selected2 ? { kind: "selected", runtime: selected2 } : { kind: "error", message: "\uC0AC\uC6A9 \uAC00\uB2A5\uD55C CPU \uAC80\uC0C9 \uB7F0\uD0C0\uC784\uC774 \uC5C6\uC2B5\uB2C8\uB2E4." };
  }
  if (device === "cuda") return { kind: "install-cuda" };
  const selected = cpu || current;
  return selected ? {
    kind: "cpu-fallback",
    runtime: selected,
    warning: "NVIDIA GPU\uAC00 \uAC10\uC9C0\uB410\uC9C0\uB9CC CUDA \uB7F0\uD0C0\uC784\uC774 \uC124\uCE58\uB418\uC9C0 \uC54A\uC544 CPU\uB97C \uC0AC\uC6A9\uD569\uB2C8\uB2E4."
  } : { kind: "install-cuda" };
}

// src/search-item-view.ts
var import_obsidian6 = require("obsidian");

// src/answer-renderer.ts
var AnswerRenderer = class {
  constructor(containerEl, options) {
    this.containerEl = containerEl;
    this.options = options;
  }
  render(answer, citations, onCopy) {
    this.containerEl.empty();
    const byId = new Map(citations.map((citation) => [citation.id, citation]));
    const counts = this.fileCounts(citations);
    const toolbar = this.containerEl.createDiv({
      cls: "vault-answer-toolbar"
    });
    if (onCopy) {
      const copy = toolbar.createEl("button", {
        text: "\uB2F5\uBCC0 \uBCF5\uC0AC",
        cls: "vault-answer-copy",
        attr: { type: "button", "aria-label": "\uB2F5\uBCC0 \uC804\uCCB4 \uD14D\uC2A4\uD2B8 \uBCF5\uC0AC" }
      });
      copy.addEventListener("click", () => {
        onCopy(answer);
        copy.setText("\uBCF5\uC0AC\uB428 \u2713");
        globalThis.setTimeout(() => copy.setText("\uB2F5\uBCC0 \uBCF5\uC0AC"), 1500);
      });
    }
    const body = this.containerEl.createDiv({ cls: "vault-answer-body" });
    this.renderBlocks(body, answer, byId, counts);
  }
  renderBlocks(container, answer, byId, counts) {
    const lines = answer.split(/\r?\n/);
    let index = 0;
    while (index < lines.length) {
      const line = lines[index].trimEnd();
      if (!line.trim()) {
        index++;
        continue;
      }
      const heading = /^(#{1,3})\s+(.+)$/.exec(line);
      if (heading) {
        const level = heading[1].length;
        const element = container.createEl(
          level === 1 ? "h3" : level === 2 ? "h4" : "h5",
          { cls: "vault-answer-heading" }
        );
        this.renderInline(element, heading[2], byId, counts);
        index++;
        continue;
      }
      const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
      const numbered = /^\s*(\d+)[.)]\s+(.+)$/.exec(line);
      if (bullet || numbered) {
        const ordered = Boolean(numbered);
        const list = container.createEl(ordered ? "ol" : "ul", {
          cls: "vault-answer-list"
        });
        while (index < lines.length) {
          const nextBullet = /^\s*[-*]\s+(.+)$/.exec(lines[index]);
          const nextNumbered = /^\s*(\d+)[.)]\s+(.+)$/.exec(lines[index]);
          const itemMatch = ordered ? nextNumbered : nextBullet;
          if (!itemMatch) break;
          const item = list.createEl("li", { cls: "vault-answer-list-item" });
          this.renderInline(item, itemMatch[1], byId, counts);
          index++;
        }
        continue;
      }
      const quote = /^\s*>\s?(.+)$/.exec(line);
      if (quote) {
        const block = container.createEl("blockquote", {
          cls: "vault-answer-quote"
        });
        this.renderInline(block, quote[1], byId, counts);
        index++;
        continue;
      }
      if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) {
        container.createEl("hr", { cls: "vault-answer-rule" });
        index++;
        continue;
      }
      if (line.trim().startsWith("|")) {
        index = this.renderTable(container, lines, index, byId, counts);
        continue;
      }
      const paragraph = container.createDiv({ cls: "vault-answer-paragraph" });
      while (index < lines.length && lines[index].trim() && !/^(?:#{1,3})\s+|^\s*[-*]\s+|^\s*\d+[.)]\s+|^\s*>\s?|^\s*\|/.test(
        lines[index]
      )) {
        if (paragraph.children.length > 0) paragraph.createEl("br");
        this.renderInline(paragraph, lines[index].trim(), byId, counts);
        index++;
      }
    }
  }
  renderTable(container, lines, index, byId, counts) {
    const rows = [];
    while (index < lines.length && lines[index].trim().startsWith("|")) {
      const cells = lines[index].trim().split("|").slice(1, -1).map((cell) => cell.trim());
      rows.push(cells);
      index++;
    }
    const isSeparator = (cells) => cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));
    const header = rows.length >= 2 && isSeparator(rows[1]) ? rows[0] : null;
    const body = header ? rows.slice(2) : rows;
    const table = container.createEl("table", { cls: "vault-answer-table" });
    if (header) {
      const thead = table.createEl("thead");
      const row = thead.createEl("tr");
      for (const cell of header) {
        const th = row.createEl("th");
        this.renderInline(th, cell, byId, counts);
      }
    }
    const tbody = table.createEl("tbody");
    for (const cells of body) {
      const row = tbody.createEl("tr");
      for (const cell of cells) {
        const td = row.createEl("td");
        this.renderInline(td, cell, byId, counts);
      }
    }
    return index;
  }
  renderInline(parent, text, byId, counts) {
    const tokenPattern = /(\*\*[^*]+\*\*|`[^`]+`|\[S\d+\])/g;
    let cursor = 0;
    for (const match of text.matchAll(tokenPattern)) {
      const index = match.index ?? 0;
      if (index > cursor)
        parent.createSpan({ text: text.slice(cursor, index) });
      const token = match[0];
      if (token.startsWith("**")) {
        parent.createEl("strong", { text: token.slice(2, -2) });
      } else if (token.startsWith("`")) {
        parent.createEl("code", { text: token.slice(1, -1) });
      } else {
        const id = token.slice(1, -1);
        const citation = byId.get(id);
        if (citation) {
          parent.createEl("button", {
            cls: "vault-answer-citation",
            text: this.citationLabel(citation, counts),
            attr: {
              type: "button",
              "aria-label": `${citation.file_path}:${citation.start_line}`
            }
          }).addEventListener(
            "click",
            () => void this.options.openCitation({
              path: citation.file_path,
              line: Math.max(1, citation.start_line)
            })
          );
        } else {
          parent.createSpan({ text: token });
        }
      }
      cursor = index + token.length;
    }
    if (cursor < text.length) parent.createSpan({ text: text.slice(cursor) });
  }
  citationLabel(citation, counts) {
    const name = citation.heading_path.length > 0 ? citation.heading_path[0] : this.fileStem(citation.file_path);
    const count = counts.get(citation.file_path) ?? 1;
    return count > 1 ? `${name} +${count}` : name;
  }
  fileStem(filePath) {
    const base = filePath.split("/").pop() ?? filePath;
    return base.replace(/\.md$/i, "");
  }
  fileCounts(citations) {
    const counts = /* @__PURE__ */ new Map();
    for (const citation of citations) {
      counts.set(citation.file_path, (counts.get(citation.file_path) ?? 0) + 1);
    }
    return counts;
  }
};

// src/answer-session.ts
var AnswerSession = class {
  constructor(answer, stateChanged) {
    this.answer = answer;
    this.stateChanged = stateChanged;
  }
  generation = 0;
  disposed = false;
  history = [];
  get conversation() {
    return this.history.map((message) => ({ ...message }));
  }
  submit(value) {
    const query = value.trim();
    if (query.length < 2 || this.disposed) {
      if (!this.disposed) this.stateChanged({ kind: "idle" });
      return;
    }
    const generation = ++this.generation;
    const conversation = this.conversation;
    this.stateChanged({ kind: "retrieving" });
    const pending = this.answer(query, conversation);
    this.stateChanged({ kind: "answering" });
    void this.resolve(pending, query, generation);
  }
  clear() {
    this.generation++;
    this.history = [];
    if (!this.disposed) this.stateChanged({ kind: "idle" });
  }
  dispose() {
    this.disposed = true;
    this.generation++;
  }
  async resolve(pending, query, generation) {
    try {
      const result = await pending;
      if (this.disposed || generation !== this.generation) return;
      this.history.push({ role: "user", content: query });
      this.history.push({ role: "assistant", content: result.answer });
      this.history = this.history.slice(-8);
      this.stateChanged({ kind: "answer", result });
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      const backendError = error instanceof BackendCallError ? error : void 0;
      const details = backendError?.details;
      const evidence = details && typeof details === "object" && "evidence" in details && Array.isArray(details.evidence) ? details.evidence : void 0;
      this.stateChanged({
        kind: "unavailable",
        code: backendError?.code,
        message: error instanceof Error ? error.message : String(error),
        evidence
      });
    }
  }
};

// src/icons.ts
var import_obsidian5 = require("obsidian");
var ICON_LIGHTNING = "vault-search-lightning";
var LIGHTNING_BOLT = '<polygon points="54.2 8.3 12.5 58.3 50 58.3 45.8 91.7 87.5 41.7 50 41.7 54.2 8.3" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>';
function registerLightningIcon() {
  (0, import_obsidian5.addIcon)(ICON_LIGHTNING, LIGHTNING_BOLT);
}

// src/search-item-view.ts
var ANSWER_TRANSPORT_MARGIN_MS = 2e3;
var INPUT_MAX_HEIGHT = 200;
var VaultSearchItemView = class extends import_obsidian6.ItemView {
  constructor(viewLeaf, owner) {
    super(viewLeaf);
    this.owner = owner;
  }
  listeners = [];
  inputEl;
  statusEl;
  answerEl;
  providerEl;
  session;
  modelSelect;
  pendingEl = null;
  lastQuery = "";
  getViewType() {
    return VIEW_TYPE_VAULT_AI_SEARCH;
  }
  getDisplayText() {
    return "AI Vault Search";
  }
  getIcon() {
    return ICON_LIGHTNING;
  }
  getState() {
    return {
      query: this.lastQuery,
      provider: this.owner.settings.answerProvider,
      model: this.owner.settings.answerModel
    };
  }
  async setState(state, result) {
    const value = state && typeof state === "object" ? state : {};
    if (typeof value.query === "string") {
      this.lastQuery = value.query;
      if (this.inputEl) {
        this.inputEl.value = this.lastQuery;
        this.autoGrowInput();
      }
    }
    await super.setState(state, result);
  }
  async onOpen() {
    this.owner.registerAiView(this);
    this.contentEl.empty();
    this.contentEl.addClass("vault-ai-search-view");
    const header = this.contentEl.createDiv({ cls: "vault-ai-search-header" });
    header.createEl("h2", { text: "AI Vault Search" });
    this.providerEl = header.createDiv({ cls: "vault-ai-search-provider" });
    const headerButton = header.createEl("button", {
      cls: "vault-ai-search-lightning-button",
      attr: { type: "button", "aria-label": "AI Vault Search \uC9C8\uBB38 \uC785\uB825" }
    });
    (0, import_obsidian6.setIcon)(headerButton, ICON_LIGHTNING);
    headerButton.addEventListener("click", () => this.inputEl?.focus());
    this.statusEl = this.contentEl.createDiv({ cls: "vault-ai-search-status" });
    this.answerEl = this.contentEl.createDiv({ cls: "vault-ai-search-answer" });
    this.session = new AnswerSession(
      (query, conversation) => this.answer(query, conversation),
      (state) => this.renderAnswerState(state)
    );
    const footer = this.contentEl.createDiv({ cls: "vault-ai-search-footer" });
    this.inputEl = footer.createEl("textarea", {
      cls: "vault-ai-search-input",
      attr: {
        rows: "2",
        placeholder: "\uBCFC\uD2B8\uC5D0 \uC9C8\uBB38\uD558\uAE30\u2026",
        title: "Enter: \uC804\uC1A1 \xB7 Shift+Enter: \uC904\uBC14\uAFC8",
        "aria-label": "AI Vault Search query"
      }
    });
    const composerBar = footer.createDiv({
      cls: "vault-ai-search-composer-bar"
    });
    composerBar.createEl("span", {
      text: "\uBAA8\uB378",
      cls: "vault-ai-search-model-label"
    });
    this.modelSelect = composerBar.createEl("select", {
      cls: "vault-ai-search-model-select",
      attr: { "aria-label": "\uB2F5\uBCC0 \uBAA8\uB378 (\uC990\uACA8\uCC3E\uAE30)" }
    });
    composerBar.createEl("span", {
      text: "Enter: \uC804\uC1A1 \xB7 Shift+Enter: \uC904\uBC14\uAFC8",
      cls: "vault-ai-search-composer-hint"
    });
    const spacer = composerBar.createDiv({
      cls: "vault-ai-search-composer-spacer"
    });
    const submit = composerBar.createEl("button", {
      text: "\uC9C8\uBB38",
      cls: "mod-cta",
      attr: { type: "button" }
    });
    const clear = composerBar.createEl("button", {
      text: "\uC9C0\uC6B0\uAE30",
      attr: { type: "button" }
    });
    const submitQuery = () => {
      const query = this.inputEl.value;
      if (query.trim().length < 2) return;
      if (!this.owner.settings.answerModel) {
        new import_obsidian6.Notice("\uB2F5\uBCC0 \uBAA8\uB378\uC744 \uBA3C\uC800 \uC120\uD0DD\uD574 \uC8FC\uC138\uC694. (\uC124\uC815\uC5D0\uC11C \u2605\uB85C \uC9C0\uC815)");
        return;
      }
      this.lastQuery = query;
      this.appendUserMessage(query);
      this.pendingEl = null;
      this.session.submit(query);
      this.inputEl.value = "";
      this.autoGrowInput();
    };
    submit.addEventListener("click", submitQuery);
    this.listeners.push(() => submit.removeEventListener("click", submitQuery));
    const onKeyDown = (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        submitQuery();
      }
    };
    this.inputEl.addEventListener("keydown", onKeyDown);
    this.listeners.push(
      () => this.inputEl.removeEventListener("keydown", onKeyDown)
    );
    const onInput = () => this.autoGrowInput();
    this.inputEl.addEventListener("input", onInput);
    this.listeners.push(
      () => this.inputEl.removeEventListener("input", onInput)
    );
    const clearQuery = () => {
      this.lastQuery = "";
      this.inputEl.value = "";
      this.autoGrowInput();
      this.session.clear();
      this.answerEl.empty();
      this.pendingEl = null;
    };
    clear.addEventListener("click", clearQuery);
    this.listeners.push(() => clear.removeEventListener("click", clearQuery));
    void spacer;
    const onModelChange = () => {
      const [provider, model] = this.modelSelect.value.split("::", 2);
      if (provider && model) {
        void this.owner.setAnswerModel(provider, model);
      }
    };
    this.modelSelect.addEventListener("change", onModelChange);
    this.listeners.push(
      () => this.modelSelect.removeEventListener("change", onModelChange)
    );
    this.inputEl.value = this.lastQuery;
    this.autoGrowInput();
    this.refreshModelSelector();
    this.renderBackendStatus(this.owner.backend.status);
    this.inputEl.focus();
  }
  async onClose() {
    this.session?.dispose();
    for (const remove of this.listeners.splice(0)) remove();
    this.owner.unregisterAiView(this);
    this.contentEl.empty();
  }
  updateBackendStatus(status) {
    if (this.statusEl) this.renderBackendStatus(status);
  }
  /** Re-populate the footer model selector from the owner's favorite list
   *  (called on open and whenever settings/models change externally). No
   *  model is presumed: with nothing chosen and no usable favorites the
   *  selector shows a placeholder and the header says 모델 미선택. */
  refreshModelSelector() {
    if (!this.modelSelect) return;
    const options = this.owner.getAnswerModelOptions();
    const currentProvider = this.owner.settings.answerProvider;
    const current = this.owner.settings.answerModel;
    const favorites = this.owner.settings.favoriteAnswerModels || [];
    this.modelSelect.empty();
    if (options.length) {
      for (const option of options) {
        const crossProvider = option.provider !== currentProvider;
        const isCurrent = option.provider === currentProvider && option.model === current;
        const isFavorite = favorites.some(
          (favorite) => favorite.provider === option.provider && favorite.model === option.model
        );
        let text = option.model;
        if (crossProvider) text = `${option.model} (${option.provider})`;
        else if (isCurrent && !isFavorite) text = `${option.model} (\uD604\uC7AC \uC124\uC815)`;
        this.modelSelect.createEl("option", {
          text,
          value: `${option.provider}::${option.model}`
        });
      }
      this.modelSelect.value = `${currentProvider}::${current}`;
    } else {
      this.modelSelect.createEl("option", {
        text: "\u2014 \uBAA8\uB378\uC744 \uC120\uD0DD\uD558\uC138\uC694 \u2014",
        value: ""
      });
      this.modelSelect.value = "";
    }
    this.modelSelect.title = "\uB2F5\uBCC0 \uBAA8\uB378 \u2014 \uC124\uC815\uC5D0\uC11C \u2605\uB85C \uC9C0\uC815\uD55C \uC990\uACA8\uCC3E\uAE30\uC785\uB2C8\uB2E4. (\uD604\uC7AC \uC124\uC815)\uC740 \uC990\uACA8\uCC3E\uAE30\uAC00 \uC544\uB2CC \uC9C0\uAE08 \uC120\uD0DD\uB41C \uBAA8\uB378\uC785\uB2C8\uB2E4.";
    if (this.providerEl) {
      this.providerEl.setText(
        this.owner.settings.answerModel ? `${this.owner.settings.answerProvider} \xB7 ${this.owner.settings.answerModel}` : "\uBAA8\uB378 \uBBF8\uC120\uD0DD"
      );
    }
  }
  autoGrowInput() {
    const el = this.inputEl;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight + 2, INPUT_MAX_HEIGHT);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > INPUT_MAX_HEIGHT ? "auto" : "hidden";
  }
  async answer(query, conversation) {
    await this.owner.ensureSearchStarted();
    const params = {
      query,
      top_k: 12,
      max_context_chars: this.owner.settings.answerMaxContextChars,
      conversation,
      // Agentic mode: the model iteratively searches / reads / greps the
      // vault (same quality as a CLI agent) before answering.
      deep: true
    };
    const timeoutMs = this.owner.settings.answerTimeoutSeconds * 1e3 * 12 + ANSWER_TRANSPORT_MARGIN_MS;
    try {
      return await this.owner.backend.call(
        "answer",
        params,
        timeoutMs
      );
    } catch (error) {
      if (error instanceof BackendCallError && error.code === "MODEL_LOADING") {
        await this.owner.ensureSearchStarted();
        return await this.owner.backend.call(
          "answer",
          params,
          timeoutMs
        );
      }
      throw error;
    }
  }
  renderAnswerState(state) {
    if (state.kind === "idle") {
      this.statusEl?.setText("");
      return;
    }
    if (state.kind === "retrieving") {
      this.setPending("\uBCFC\uD2B8 \uADFC\uAC70\uB97C \uCC3E\uB294 \uC911\u2026");
      return;
    }
    if (state.kind === "answering") {
      this.setPending("\uB2F5\uBCC0\uC744 \uC791\uC131\uD558\uB294 \uC911\u2026");
      return;
    }
    if (state.kind === "answer") {
      this.renderAnswer(state.result);
      return;
    }
    this.renderUnavailable(state);
  }
  appendUserMessage(text) {
    const bubble = this.answerEl.createDiv({ cls: "vault-ai-search-user" });
    bubble.setText(text);
    this.scrollToBottom();
  }
  setPending(text) {
    if (!this.pendingEl) {
      this.pendingEl = this.answerEl.createDiv({
        cls: "vault-ai-search-assistant"
      });
      this.pendingEl.createDiv({ cls: "vault-ai-search-thinking" });
    }
    const label = this.pendingEl.querySelector(
      ".vault-ai-search-thinking"
    );
    if (label) label.setText(text);
    this.scrollToBottom();
  }
  clearPending() {
    if (this.pendingEl) {
      this.pendingEl.remove();
      this.pendingEl = null;
    }
  }
  renderMessageEvidence(block, evidence) {
    const details = block.createEl("details", {
      cls: "vault-ai-search-evidence"
    });
    details.createEl("summary", {
      text: `\uADFC\uAC70 \uD3BC\uCE58\uAE30 (${evidence.length})`
    });
    const list = details.createDiv({ cls: "vault-ai-search-source-list" });
    const view = new SearchResultView(
      list,
      (location) => this.owner.openSearchResult(location, true)
    );
    view.render(evidence);
  }
  scrollToBottom() {
    this.answerEl.scrollTop = this.answerEl.scrollHeight;
  }
  renderUnavailable(state) {
    this.clearPending();
    const block = this.answerEl.createDiv({
      cls: "vault-ai-search-assistant"
    });
    const meta = block.createDiv({ cls: "vault-ai-search-thought" });
    meta.setText("\uB2F5\uBCC0\uC744 \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4");
    meta.addClass("vault-search-error");
    block.createDiv({ cls: "vault-ai-search-answer-body" }).setText(
      state.message
    );
    if (state.evidence?.length) {
      this.renderMessageEvidence(block, state.evidence);
    }
    const retry = block.createEl("button", {
      text: "\uB2E4\uC2DC \uC2DC\uB3C4",
      attr: { type: "button" }
    });
    retry.addEventListener(
      "click",
      () => this.session.submit(this.lastQuery)
    );
    this.scrollToBottom();
  }
  renderAnswer(result) {
    this.statusEl?.removeClass("vault-search-error");
    this.clearPending();
    const block = this.answerEl.createDiv({
      cls: "vault-ai-search-assistant"
    });
    const deep = result.diagnostics.deep ? ` \xB7 \uC870\uC0AC ${result.diagnostics.turns ?? 0}\uD134` : "";
    const meta = block.createDiv({ cls: "vault-ai-search-thought" });
    meta.setText(
      `${result.provider} \xB7 ${result.model}${result.grounded ? " \xB7 \uADFC\uAC70 \uC788\uC74C" : " \xB7 \uADFC\uAC70 \uBD80\uC871"}${deep}`
    );
    const body = block.createDiv({ cls: "vault-ai-search-answer-body" });
    const renderer = new AnswerRenderer(body, {
      openCitation: (location) => this.owner.openSearchResult(location, true)
    });
    renderer.render(
      result.answer,
      result.citations,
      (text) => this.copyAnswer(text)
    );
    if (result.evidence.length) {
      this.renderMessageEvidence(block, result.evidence);
    }
    this.scrollToBottom();
  }
  renderBackendStatus(status) {
    if (status.state === "error") {
      this.statusEl.setText(
        status.error || "\uAC80\uC0C9 \uC11C\uBE44\uC2A4\uB97C \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4."
      );
      this.statusEl.addClass("vault-search-error");
    } else if (status.state === "idle") {
      this.statusEl.setText("\uBAA8\uB378 \uB300\uAE30 \uC911 \xB7 \uC9C8\uBB38 \uC2DC \uBAA8\uB378\uC744 \uB85C\uB4DC\uD569\uB2C8\uB2E4.");
    } else if (status.state === "starting" || status.state === "loading_model") {
      this.statusEl.setText("\uAC80\uC0C9 \uBAA8\uB378\uC744 \uB85C\uB4DC\uD558\uACE0 \uC788\uC2B5\uB2C8\uB2E4\u2026");
    }
  }
  copyAnswer(text) {
    const notify = (ok) => new import_obsidian6.Notice(ok ? "\uB2F5\uBCC0\uC744 \uBCF5\uC0AC\uD588\uC2B5\uB2C8\uB2E4." : "\uB2F5\uBCC0 \uBCF5\uC0AC\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.");
    if (navigator.clipboard && window.isSecureContext) {
      void navigator.clipboard.writeText(text).then(() => notify(true)).catch(() => this.copyAnswerFallback(text, notify));
    } else {
      this.copyAnswerFallback(text, notify);
    }
  }
  copyAnswerFallback(text, notify) {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    notify(ok);
  }
};

// src/main.ts
var PROVIDER_IDS = ["openai", "opencode-go", "deepseek"];
function normalizeFavoriteModels(raw, fallbackProvider) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const entry of raw) {
    let provider = fallbackProvider;
    let model = "";
    if (typeof entry === "string") {
      model = entry.trim();
    } else if (entry && typeof entry === "object") {
      const value = entry;
      model = typeof value.model === "string" ? value.model.trim() : "";
      if (PROVIDER_IDS.includes(value.provider)) {
        provider = value.provider;
      }
    }
    if (!model) continue;
    const key = `${provider}::${model}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ provider, model });
    }
  }
  return out;
}
var VaultSearchPlugin = class extends import_obsidian7.Plugin {
  draftSettings;
  backend;
  queue;
  settingTab;
  startupPrepared = false;
  startupInProgress = false;
  searchModal = null;
  aiSearchViews = /* @__PURE__ */ new Set();
  runtimeChangePromise = null;
  providerModels = {};
  runtimeSummary = "\uB7F0\uD0C0\uC784: \uD655\uC778 \uC804";
  runtimeWarning = null;
  /** Installed state of the agent integration (AGENTS.md block + wrapper + skill). */
  agentIntegration = null;
  async onload() {
    registerLightningIcon();
    await this.loadSettings();
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof import_obsidian7.FileSystemAdapter)) {
      new import_obsidian7.Notice(
        "Vault Search Service\uB294 \uB370\uC2A4\uD06C\uD1B1 \uD30C\uC77C\uC2DC\uC2A4\uD15C \uBCFC\uD2B8\uB9CC \uC9C0\uC6D0\uD569\uB2C8\uB2E4."
      );
      return;
    }
    const vaultPath = adapter.getBasePath();
    const pluginDir = path4.join(
      vaultPath,
      this.app.vault.configDir,
      "plugins",
      this.manifest.id
    );
    this.backend = new BackendManager(
      vaultPath,
      pluginDir,
      () => this.settings,
      (status) => this.handleStatus(status),
      this.manifest.version,
      () => providerEnvironment(this.app)
    );
    const machinePython = await this.backend.readMachinePython();
    if (machinePython) this.settings.pythonExecutable = machinePython;
    else await this.backend.writeMachinePython(this.settings.pythonExecutable);
    this.draftSettings = cloneSettings(this.settings);
    this.queue = new VaultEventQueue(
      () => this.settings.syncDebounceMs,
      async (changed, deleted) => {
        if (!this.settings.autoSync) return true;
        if (!this.isReady()) return false;
        await this.backend.call("sync_paths", { changed, deleted }, 12e4);
        return true;
      }
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof import_obsidian7.TFile) this.queue.markChanged(file.path);
      })
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof import_obsidian7.TFile) this.queue.markChanged(file.path);
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof import_obsidian7.TFile) this.queue.markDeleted(file.path);
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof import_obsidian7.TFile) {
          this.queue.markDeleted(oldPath);
          this.queue.markChanged(file.path);
        }
      })
    );
    this.settingTab = new VaultSearchSettingTab(this);
    this.addSettingTab(this.settingTab);
    this.registerView(
      VIEW_TYPE_VAULT_AI_SEARCH,
      (leaf) => new VaultSearchItemView(leaf, this)
    );
    const ribbonIcon = this.addRibbonIcon(
      ICON_LIGHTNING,
      "Open AI Vault Search",
      () => {
        void this.openAiSearchPanel();
      }
    );
    void ribbonIcon;
    this.registerCommands();
    void this.refreshAgentIntegration();
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.loadPolicy === "vault-open") {
        void this.startBackend().catch(
          (error) => new import_obsidian7.Notice(
            `Vault Search \uC2DC\uC791 \uC2E4\uD328: ${this.errorMessage(error)}`,
            1e4
          )
        );
      } else if (this.settings.loadPolicy === "first-search") {
        void this.startLazyBackend().catch(
          (error) => new import_obsidian7.Notice(
            `Vault Search \uB300\uAE30 \uC11C\uBE44\uC2A4 \uC2DC\uC791 \uC2E4\uD328: ${this.errorMessage(error)}`,
            1e4
          )
        );
      }
    });
  }
  onunload() {
    this.queue?.clear();
    if (this.backend) void this.backend.stop(true);
  }
  async loadSettings() {
    const loaded = await this.loadData();
    this.settings = { ...DEFAULT_SETTINGS, ...loaded || {} };
    this.settings.includeGlobs = loaded?.includeGlobs || [
      ...DEFAULT_SETTINGS.includeGlobs
    ];
    this.settings.excludeGlobs = loaded?.excludeGlobs || [
      ...DEFAULT_SETTINGS.excludeGlobs
    ];
    const rawFavorites = loaded?.favoriteAnswerModels;
    this.settings.favoriteAnswerModels = Array.isArray(rawFavorites) ? normalizeFavoriteModels(rawFavorites, this.settings.answerProvider) : [];
    if (!(this.settings.answerProvider in { openai: true, "opencode-go": true, deepseek: true }))
      this.settings.answerProvider = DEFAULT_SETTINGS.answerProvider;
    this.settings.answerModel = String(
      this.settings.answerModel || DEFAULT_SETTINGS.answerModel
    );
    this.settings.answerMaxContextChars = Math.max(
      8e3,
      Math.min(
        32e3,
        Number(this.settings.answerMaxContextChars) || DEFAULT_SETTINGS.answerMaxContextChars
      )
    );
    this.settings.answerMaxOutputTokens = Math.max(
      128,
      Math.min(
        8e3,
        Number(this.settings.answerMaxOutputTokens) || DEFAULT_SETTINGS.answerMaxOutputTokens
      )
    );
    this.settings.answerTimeoutSeconds = Math.max(
      5,
      Math.min(
        60,
        Number(this.settings.answerTimeoutSeconds) || DEFAULT_SETTINGS.answerTimeoutSeconds
      )
    );
    const migrated = migrateSettings(this.settings);
    if (loaded?.loadPolicy === void 0) {
      this.settings.loadPolicy = defaultLoadPolicy(this.settings.engine);
    }
    this.draftSettings = cloneSettings(this.settings);
    if (migrated || loaded?.loadPolicy === void 0) {
      await this.saveSettings();
    }
  }
  async saveSettings() {
    const { pythonExecutable, ...portable } = this.settings;
    await this.saveData(portable);
    if (this.backend) await this.backend.writeMachinePython(pythonExecutable);
  }
  getProviderApiKey(provider) {
    return getProviderSecret(this.app, provider);
  }
  async saveProviderApiKey(provider, value) {
    if (!hasSecretStorage(this.app)) {
      throw new Error(
        "Obsidian 1.11.4 \uC774\uC0C1\uC5D0\uC11C\uB9CC API \uD0A4\uB97C \uBCF4\uC548 \uC800\uC7A5\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4."
      );
    }
    setProviderSecret(this.app, provider, value);
    if (this.backend.status.state !== "stopped") await this.backend.restart();
  }
  async fetchProviderModels(provider) {
    const apiKey = getProviderSecret(this.app, provider);
    if (!apiKey) throw new Error("\uBA3C\uC800 \uC774 provider\uC758 API \uD0A4\uB97C \uC800\uC7A5\uD574 \uC8FC\uC138\uC694.");
    const response = await (0, import_obsidian7.requestUrl)({
      url: LLM_MODEL_ENDPOINTS[provider],
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    const data = response.json?.data;
    if (!Array.isArray(data))
      throw new Error("provider\uAC00 \uBAA8\uB378 \uBAA9\uB85D\uC744 \uBC18\uD658\uD558\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4.");
    return normalizeProviderModels(provider, data);
  }
  /** Cache of fetched model lists per provider (shared by settings + view). */
  setProviderModels(provider, models) {
    this.providerModels[provider] = models;
    for (const view of this.aiSearchViews) view.refreshModelSelector();
  }
  /** Models the AI search footer offers: the chosen model (if any) plus
   *  favorites from ALL providers that have an API key configured — models of
   *  a provider without a key are never offered, and nothing is presumed:
   *  with no choice and no favorites the selector stays empty. Selecting a
   *  cross-provider favorite also switches the provider. */
  getAnswerModelOptions() {
    const favorites = (this.settings.favoriteAnswerModels || []).filter(
      (favorite) => favorite?.model && this.hasProviderKey(favorite.provider)
    );
    const currentProvider = this.settings.answerProvider;
    const options = [];
    const seen = /* @__PURE__ */ new Set();
    const push = (provider, model) => {
      const key = `${provider}::${model}`;
      if (!seen.has(key)) {
        seen.add(key);
        options.push({ provider, model });
      }
    };
    if (this.settings.answerModel) {
      push(currentProvider, this.settings.answerModel);
    }
    for (const favorite of favorites) {
      push(favorite.provider, favorite.model);
    }
    if (favorites.length) return options;
    if (options.length) return options;
    if (this.hasProviderKey(currentProvider)) {
      for (const model of this.providerModels[currentProvider] || []) {
        push(currentProvider, model);
      }
    }
    return options;
  }
  hasProviderKey(provider) {
    return Boolean(getProviderSecret(this.app, provider));
  }
  /** Change the answer provider/model (hot — no restart; the backend picks
   *  it up on the next answer request). Persists immediately so a plugin
   *  update/reload never loses the choice. */
  async setAnswerModel(provider, model, options) {
    const value = model.trim();
    const previous = this.settings.answerModel;
    const previousProvider = this.settings.answerProvider;
    if (!value || value === previous && provider === previousProvider) return;
    this.settings.answerProvider = provider;
    this.settings.answerModel = value;
    this.draftSettings.answerProvider = provider;
    this.draftSettings.answerModel = value;
    await this.saveSettings();
    if (this.backend.status.state !== "stopped") {
      await this.backend.call("apply_search_config", hotConfig(this.settings), 3e4).catch(() => void 0);
    }
    for (const view of this.aiSearchViews) view.refreshModelSelector();
    if (options?.notify ?? true) {
      new import_obsidian7.Notice(
        provider === previousProvider ? `\uB2F5\uBCC0 \uBAA8\uB378\uC744 ${value}(\uC73C)\uB85C \uBCC0\uACBD\uD588\uC2B5\uB2C8\uB2E4.` : `\uB2F5\uBCC0 provider\uB97C ${provider}\uB85C \uC804\uD658\uD558\uACE0 \uBAA8\uB378\uC744 ${value}(\uC73C)\uB85C \uBCC0\uACBD\uD588\uC2B5\uB2C8\uB2E4.`
      );
    }
  }
  /** Star/unstar a model from the settings list. Persists immediately (hot)
   *  so favorites survive plugin updates; cross-provider favorites are all
   *  offered in the AI search footer selector. */
  async toggleFavoriteModel(provider, model) {
    const favorites = (this.settings.favoriteAnswerModels || []).map(
      (favorite) => ({ ...favorite })
    );
    const index = favorites.findIndex(
      (favorite) => favorite.provider === provider && favorite.model === model
    );
    if (index >= 0) favorites.splice(index, 1);
    else favorites.push({ provider, model });
    this.settings.favoriteAnswerModels = favorites;
    this.draftSettings.favoriteAnswerModels = favorites.map((favorite) => ({
      ...favorite
    }));
    await this.saveSettings();
    if (this.backend.status.state !== "stopped") {
      await this.backend.call("apply_search_config", hotConfig(this.settings), 3e4).catch(() => void 0);
    }
    for (const view of this.aiSearchViews) view.refreshModelSelector();
  }
  resetDraftSettings() {
    this.draftSettings = cloneSettings(this.settings);
    this.settingTab?.display();
  }
  async applyDraftSettings() {
    if (this.runtimeChangePromise) return this.runtimeChangePromise;
    this.runtimeChangePromise = this.applyDraftSettingsInternal();
    try {
      await this.runtimeChangePromise;
    } finally {
      this.runtimeChangePromise = null;
    }
  }
  async applyDraftSettingsInternal() {
    const previous = cloneSettings(this.settings);
    const next = cloneSettings(this.draftSettings);
    const impact = settingsImpact(previous, next);
    if (impact === "none") return;
    if (previous.device !== next.device || previous.engine !== next.engine || previous.pythonExecutable !== next.pythonExecutable) {
      await this.prepareRuntime(next, true);
    }
    const previousWasRunning = this.backend.status.state !== "stopped";
    try {
      if (impact === "all" || impact === "vectors" || impact === "restart") {
        await this.backend.stop();
        this.settings = next;
        await this.saveSettings();
        await this.backend.start(false);
        await this.backend.waitUntilReady();
        if (impact === "all")
          await this.backend.call("rebuild_all", {}, 36e5);
        if (impact === "vectors")
          await this.backend.call("rebuild_vectors", {}, 36e5);
        if (!previousWasRunning && this.settings.loadPolicy === "manual")
          await this.backend.stop();
      } else {
        this.settings = next;
        await this.saveSettings();
        if (this.backend.status.state !== "stopped") {
          await this.backend.call("apply_search_config", hotConfig(next));
          if (impact === "scope" && this.isReady())
            await this.backend.call("reconcile", { mode: "fast" }, 6e5);
        }
      }
      this.draftSettings = cloneSettings(this.settings);
      new import_obsidian7.Notice(
        impact === "all" ? "\uC124\uC815\uC744 \uC801\uC6A9\uD558\uACE0 \uC804\uCCB4 \uC778\uB371\uC2A4\uB97C \uC7AC\uAD6C\uCD95\uD588\uC2B5\uB2C8\uB2E4." : impact === "vectors" ? "\uC124\uC815\uC744 \uC801\uC6A9\uD558\uACE0 \uBCA1\uD130 \uC778\uB371\uC2A4\uB97C \uC7AC\uAD6C\uCD95\uD588\uC2B5\uB2C8\uB2E4." : "Vault Search \uC124\uC815\uC744 \uC801\uC6A9\uD588\uC2B5\uB2C8\uB2E4."
      );
    } catch (error) {
      await this.backend.stop().catch(() => void 0);
      this.settings = previous;
      this.draftSettings = next;
      await this.saveSettings();
      if (previousWasRunning) {
        await this.backend.start(false);
        await this.backend.waitUntilReady();
      }
      throw error;
    } finally {
      this.settingTab?.display();
      for (const view of this.aiSearchViews) view.refreshModelSelector();
    }
  }
  async startBackend() {
    await this.prepareRuntime(this.settings, false);
    await this.backend.ensureStarted();
    await this.completeStartup();
    this.settingTab?.display();
  }
  async installCudaRuntime() {
    if (this.runtimeChangePromise) return this.runtimeChangePromise;
    this.runtimeChangePromise = this.installCudaRuntimeInternal();
    try {
      await this.runtimeChangePromise;
    } finally {
      this.runtimeChangePromise = null;
    }
  }
  async installCudaRuntimeInternal() {
    const current = await this.backend.inspectPython(
      this.settings.pythonExecutable
    );
    const cuda = await this.backend.managedRuntime("cuda");
    if (current?.cudaAvailable || cuda?.cudaAvailable) {
      new import_obsidian7.Notice(
        current?.cudaAvailable ? "\uD604\uC7AC \uB7F0\uD0C0\uC784\uC774 \uC774\uBBF8 CUDA\uB97C \uC0AC\uC6A9 \uC911\uC785\uB2C8\uB2E4." : "\uC124\uCE58\uB41C CUDA \uB7F0\uD0C0\uC784\uC774 \uC774\uBBF8 \uC0AC\uC6A9 \uAC00\uB2A5\uD569\uB2C8\uB2E4.",
        8e3
      );
      this.settingTab?.display();
      return;
    }
    if (!await this.backend.hasNvidiaGpu()) {
      throw new Error("NVIDIA GPU \uB610\uB294 \uB4DC\uB77C\uC774\uBC84\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
    }
    if (!await confirmRuntimeInstall(this.app, true)) return;
    const cpu = await this.backend.managedRuntime("cpu");
    const basePython = current?.baseExecutable || cpu?.baseExecutable || "python";
    new import_obsidian7.Notice(
      "CUDA \uB7F0\uD0C0\uC784\uC744 \uC124\uCE58\uD558\uACE0 \uC788\uC2B5\uB2C8\uB2E4. \uC218 \uBD84 \uC774\uC0C1 \uAC78\uB9B4 \uC218 \uC788\uC2B5\uB2C8\uB2E4.",
      1e4
    );
    const installed = await this.backend.installManagedRuntime(
      "cuda",
      basePython,
      (text) => {
        if (text)
          this.runtimeSummary = `CUDA \uC124\uCE58 \uC911: ${text.split(/\r?\n/).at(-1)}`;
      }
    );
    this.runtimeSummary = `\uB7F0\uD0C0\uC784: CUDA ${installed.cudaBuild || ""} / ${installed.deviceName || "GPU"}`;
    this.runtimeWarning = null;
    if (this.settings.device === "cpu") {
      const active = current || cpu;
      this.runtimeSummary = active ? `\uB7F0\uD0C0\uC784: CPU / PyTorch ${active.torchVersion} (CUDA \uB7F0\uD0C0\uC784 \uC124\uCE58\uB428)` : "\uB7F0\uD0C0\uC784: CPU (CUDA \uB7F0\uD0C0\uC784 \uC124\uCE58\uB428)";
      new import_obsidian7.Notice(
        "CUDA \uB7F0\uD0C0\uC784\uC744 \uC124\uCE58\uD588\uC2B5\uB2C8\uB2E4. \uD604\uC7AC CPU \uBA85\uC2DC \uC124\uC815\uC740 \uC720\uC9C0\uB429\uB2C8\uB2E4.",
        1e4
      );
      this.settingTab?.display();
      return;
    }
    const previous = cloneSettings(this.settings);
    const previousDraft = cloneSettings(this.draftSettings);
    const wasRunning = this.backend.status.state !== "stopped";
    try {
      if (wasRunning) await this.backend.stop();
      this.settings.pythonExecutable = installed.pythonExecutable;
      this.draftSettings.pythonExecutable = installed.pythonExecutable;
      if (wasRunning) {
        await this.backend.start(false);
        await this.backend.waitUntilReady();
        await this.backend.call("rebuild_vectors", {}, 36e5);
      }
      await this.saveSettings();
    } catch (error) {
      await this.backend.stop().catch(() => void 0);
      this.settings = previous;
      this.draftSettings = previousDraft;
      await this.saveSettings();
      if (wasRunning) {
        await this.backend.start(false);
        await this.backend.waitUntilReady();
      }
      throw error;
    }
    new import_obsidian7.Notice("CUDA \uB7F0\uD0C0\uC784 \uC124\uCE58\uC640 \uC801\uC6A9\uC744 \uC644\uB8CC\uD588\uC2B5\uB2C8\uB2E4.", 1e4);
    this.settingTab?.display();
  }
  async startLazyBackend() {
    await this.prepareRuntime(this.settings, false);
    await this.backend.start(true);
    await this.backend.waitUntilAvailable();
    this.settingTab?.display();
  }
  async ensureSearchStarted() {
    if (this.backend.status.state === "stopped" || this.backend.status.state === "error") {
      await this.prepareRuntime(this.settings, false);
    }
    await this.backend.ensureStarted();
  }
  async provisionOnnx() {
    if (this.backend.status.state === "stopped") {
      await this.prepareRuntime(this.settings, false);
      await this.backend.start(false);
      try {
        await this.backend.waitUntilAvailable();
      } catch {
      }
    }
    const result = await this.backend.call("provision_onnx", {}, 6e5);
    if (!result.provisioned) throw new Error("ONNX \uD30C\uC0DD \uBAA8\uB378 \uC0DD\uC131 \uC2E4\uD328");
    new import_obsidian7.Notice("ONNX \uD30C\uC0DD \uBAA8\uB378\uC744 \uC0DD\uC131\uD588\uC2B5\uB2C8\uB2E4. \uC11C\uBE44\uC2A4\uB97C \uC7AC\uC2DC\uC791\uD569\uB2C8\uB2E4.", 8e3);
    await this.restartBackend();
  }
  async provisionBackend() {
    await this.backend.stop();
    await this.backend.ensureBackendProvisioned({ force: true });
    new import_obsidian7.Notice("Python \uBC31\uC5D4\uB4DC\uB97C \uC124\uCE58\uD588\uC2B5\uB2C8\uB2E4. \uC11C\uBE44\uC2A4\uB97C \uC7AC\uC2DC\uC791\uD569\uB2C8\uB2E4.", 8e3);
    await this.restartBackend();
  }
  async stopBackend() {
    this.startupPrepared = false;
    await this.backend.stop();
    this.settingTab?.display();
  }
  async restartBackend() {
    this.startupPrepared = false;
    await this.prepareRuntime(this.settings, false);
    await this.backend.restart();
    await this.completeStartup();
    this.settingTab?.display();
    new import_obsidian7.Notice("Vault Search Service\uB97C \uC7AC\uC2DC\uC791\uD588\uC2B5\uB2C8\uB2E4.");
  }
  async previewScope() {
    await this.ensureSearchStarted();
    return this.backend.call("preview_scope", {}, 12e4);
  }
  async reconcile(mode = "strict") {
    await this.ensureSearchStarted();
    const result = await this.backend.call(
      "reconcile",
      { mode },
      6e5
    );
    new import_obsidian7.Notice(
      result.rebuild_required ? `\uC7AC\uAD6C\uCD95 \uD544\uC694: ${result.reason}` : "\uC778\uB371\uC2A4 \uC99D\uBD84 \uB300\uC870\uB97C \uC644\uB8CC\uD588\uC2B5\uB2C8\uB2E4.",
      8e3
    );
    this.settingTab?.display();
  }
  async rebuildAll() {
    await this.ensureSearchStarted();
    new import_obsidian7.Notice("\uC804\uCCB4 \uC778\uB371\uC2A4 \uC7AC\uAD6C\uCD95\uC744 \uC2DC\uC791\uD569\uB2C8\uB2E4. \uBC31\uADF8\uB77C\uC6B4\uB4DC\uC5D0\uC11C \uC9C4\uD589\uB429\uB2C8\uB2E4.");
    const result = await this.backend.call(
      "rebuild_all",
      {},
      36e5
    );
    new import_obsidian7.Notice(
      `\uC804\uCCB4 \uC7AC\uAD6C\uCD95 \uC644\uB8CC: \uD30C\uC77C ${result.files}\uAC1C, \uCCAD\uD06C ${result.chunks}\uAC1C`,
      1e4
    );
    this.settingTab?.display();
  }
  async rebuildVectors() {
    await this.ensureSearchStarted();
    new import_obsidian7.Notice("\uBCA1\uD130 \uC778\uB371\uC2A4 \uC7AC\uAD6C\uCD95\uC744 \uC2DC\uC791\uD569\uB2C8\uB2E4.");
    const result = await this.backend.call(
      "rebuild_vectors",
      {},
      36e5
    );
    new import_obsidian7.Notice(`\uBCA1\uD130 \uC7AC\uAD6C\uCD95 \uC644\uB8CC: \uCCAD\uD06C ${result.chunks}\uAC1C`, 1e4);
    this.settingTab?.display();
  }
  registerCommands() {
    this.addCommand({
      id: "open-search",
      name: "Open search",
      callback: () => this.openSearch()
    });
    this.addCommand({
      id: "open-ai-search",
      name: "Open AI Vault Search",
      callback: () => void this.openAiSearchPanel()
    });
    this.addCommand({
      id: "search-selected-text",
      name: "Search selected text",
      editorCallback: (editor) => this.openSearch(selectedTextQuery(editor))
    });
    this.addCommand({
      id: "start-service",
      name: "Start search service",
      callback: () => void this.startBackend()
    });
    this.addCommand({
      id: "stop-service",
      name: "Stop search service",
      callback: () => void this.stopBackend()
    });
    this.addCommand({
      id: "restart-service",
      name: "Restart search service",
      callback: () => void this.restartBackend()
    });
    this.addCommand({
      id: "reconcile-index",
      name: "Reconcile search index",
      callback: () => void this.reconcile()
    });
    this.addCommand({
      id: "rebuild-index",
      name: "Rebuild complete search index",
      callback: () => void this.rebuildAll()
    });
    this.addCommand({
      id: "rebuild-vectors",
      name: "Rebuild vector index",
      callback: () => void this.rebuildVectors()
    });
    this.addCommand({
      id: "install-agent-integration",
      name: "Install agent integration (AGENTS.md + wrapper + skill)",
      callback: () => {
        void this.runAgentIntegrationInstall().then((result) => {
          new import_obsidian7.Notice(agentIntegrationNotice(result), 8e3);
          this.settingTab?.display();
        }).catch(
          (error) => new import_obsidian7.Notice(
            `Vault Search \uC624\uB958: ${this.errorMessage(error)}`,
            8e3
          )
        );
      }
    });
  }
  async refreshAgentIntegration() {
    this.agentIntegration = await agentIntegrationStatus(
      this.backend.vaultPath,
      this.backend.pluginDir
    );
    this.settingTab?.display();
  }
  async runAgentIntegrationInstall() {
    const result = await installAgentIntegration(
      this.backend.vaultPath,
      this.backend.pluginDir
    );
    await this.refreshAgentIntegration();
    return result;
  }
  async prepareRuntime(target, interactive) {
    await this.backend.ensureBackendProvisioned();
    const current = await this.backend.inspectPython(target.pythonExecutable);
    const cpu = await this.backend.managedRuntime("cpu");
    const cuda = await this.backend.managedRuntime("cuda");
    const choose = (python, summary) => {
      target.pythonExecutable = python;
      this.runtimeSummary = summary;
      this.runtimeWarning = null;
    };
    const persist = () => this.backend.writeMachinePython(target.pythonExecutable);
    const hasGpu = await this.backend.hasNvidiaGpu();
    const selection = selectRuntime(target.device, current, cpu, cuda, hasGpu);
    if (selection.kind === "error") throw new Error(selection.message);
    if (selection.kind === "selected") {
      const selected = selection.runtime;
      choose(
        selected.pythonExecutable,
        selected.cudaAvailable ? `\uB7F0\uD0C0\uC784: CUDA ${selected.cudaBuild || ""} / ${selected.deviceName || "GPU"}` : `\uB7F0\uD0C0\uC784: CPU / PyTorch ${selected.torchVersion}`
      );
      await persist();
      return;
    }
    if (selection.kind === "cpu-fallback" && !interactive) {
      target.pythonExecutable = selection.runtime.pythonExecutable;
      this.runtimeSummary = `\uB7F0\uD0C0\uC784: CPU / PyTorch ${selection.runtime.torchVersion}`;
      this.runtimeWarning = selection.warning;
      await persist();
      return;
    }
    const install = interactive && await confirmRuntimeInstall(this.app, target.device === "cuda");
    if (!install) {
      if (target.device === "cuda")
        throw new Error(
          interactive ? "CUDA \uB7F0\uD0C0\uC784 \uC124\uCE58\uAC00 \uCDE8\uC18C\uB418\uC5B4 \uC124\uC815\uC744 \uC801\uC6A9\uD558\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4." : "CUDA \uB7F0\uD0C0\uC784\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uC124\uC815\uC5D0\uC11C CUDA \uB7F0\uD0C0\uC784\uC744 \uBA3C\uC800 \uC124\uCE58\uD574 \uC8FC\uC138\uC694."
        );
      const selected = selection.kind === "cpu-fallback" ? selection.runtime : cpu || current;
      if (!selected) throw new Error("\uC0AC\uC6A9 \uAC00\uB2A5\uD55C CPU \uAC80\uC0C9 \uB7F0\uD0C0\uC784\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.");
      target.pythonExecutable = selected.pythonExecutable;
      this.runtimeSummary = `\uB7F0\uD0C0\uC784: CPU / PyTorch ${selected.torchVersion}`;
      this.runtimeWarning = "NVIDIA GPU\uAC00 \uAC10\uC9C0\uB410\uC9C0\uB9CC CUDA \uB7F0\uD0C0\uC784\uC774 \uC124\uCE58\uB418\uC9C0 \uC54A\uC544 CPU\uB97C \uC0AC\uC6A9\uD569\uB2C8\uB2E4.";
      await persist();
      return;
    }
    const basePython = current?.baseExecutable || cpu?.baseExecutable || "python";
    try {
      new import_obsidian7.Notice(
        "CUDA \uB7F0\uD0C0\uC784\uC744 \uC124\uCE58\uD558\uACE0 \uC788\uC2B5\uB2C8\uB2E4. \uC218 \uBD84 \uC774\uC0C1 \uAC78\uB9B4 \uC218 \uC788\uC2B5\uB2C8\uB2E4.",
        1e4
      );
      const installed = await this.backend.installManagedRuntime(
        "cuda",
        basePython,
        (text) => {
          if (text)
            this.runtimeSummary = `CUDA \uC124\uCE58 \uC911: ${text.split(/\r?\n/).at(-1)}`;
        }
      );
      choose(
        installed.pythonExecutable,
        `\uB7F0\uD0C0\uC784: CUDA ${installed.cudaBuild || ""} / ${installed.deviceName || "GPU"}`
      );
    } catch (error) {
      if (target.device === "cuda") throw error;
      const selected = cpu || current;
      if (!selected) throw error;
      target.pythonExecutable = selected.pythonExecutable;
      this.runtimeSummary = `\uB7F0\uD0C0\uC784: CPU / PyTorch ${selected.torchVersion}`;
      this.runtimeWarning = `CUDA \uB7F0\uD0C0\uC784 \uC124\uCE58 \uC2E4\uD328\uB85C CPU\uB97C \uC0AC\uC6A9\uD569\uB2C8\uB2E4: ${this.errorMessage(error)}`;
    }
    await persist();
  }
  handleStatus(status) {
    this.settingTab?.display();
    this.searchModal?.updateBackendStatus(status);
    for (const view of this.aiSearchViews) view.updateBackendStatus(status);
    if (status.state === "ready" || status.state === "ready_no_index") {
      if (this.startupPrepared) void this.queue?.flush();
      else void this.completeStartup();
    }
  }
  async completeStartup() {
    if (this.startupPrepared || this.startupInProgress || !this.isReady())
      return;
    this.startupInProgress = true;
    try {
      this.queue?.clear();
      if (this.settings.startupReconcile) {
        const result = await this.backend.call(
          "reconcile",
          { mode: "fast" },
          6e5
        );
        if (result.rebuild_required) {
          const status = this.backend.status;
          const action = status.recommended_action === "rebuild_vectors" ? "\uBCA1\uD130 \uC7AC\uAD6C\uCD95" : "\uC804\uCCB4 \uC7AC\uAD6C\uCD95";
          new import_obsidian7.Notice(
            `Vault Search \uC778\uB371\uC2A4\uC5D0 \uD638\uD658\uC131 \uBB38\uC81C\uAC00 \uC788\uC2B5\uB2C8\uB2E4. \uC124\uC815\uC5D0\uC11C ${action}\uC744 \uC2E4\uD589\uD558\uC138\uC694.`,
            8e3
          );
        }
      }
      this.startupPrepared = true;
    } finally {
      this.startupInProgress = false;
    }
    await this.queue?.flush();
  }
  isReady() {
    const state = this.backend.status.state;
    return state === "ready" || state === "ready_no_index";
  }
  errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }
  openSearch(initialQuery = "") {
    this.searchModal?.close();
    this.searchModal = new VaultSearchModal(this, initialQuery);
    this.searchModal.open();
  }
  async openSearchResult(location, keepPanel = false) {
    const file = this.app.vault.getAbstractFileByPath(location.path);
    if (!(file instanceof import_obsidian7.TFile)) {
      new import_obsidian7.Notice(`\uD30C\uC77C\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4: ${location.path}`);
      return;
    }
    await this.app.workspace.getLeaf(keepPanel ? "tab" : false).openFile(file, {
      active: true,
      eState: { line: location.line - 1 }
    });
    if (!keepPanel) this.searchModal?.close();
  }
  async openAiSearchPanel(initialQuery = "") {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_VAULT_AI_SEARCH)[0] ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      new import_obsidian7.Notice("AI Vault Search \uD328\uB110\uC744 \uC5F4 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
      return;
    }
    const currentState = leaf.getViewState();
    await leaf.setViewState({
      type: VIEW_TYPE_VAULT_AI_SEARCH,
      active: true,
      state: {
        ...currentState.state || {},
        ...initialQuery ? { query: initialQuery } : {}
      }
    });
    await this.app.workspace.revealLeaf(leaf);
  }
  registerAiView(view) {
    this.aiSearchViews.add(view);
  }
  unregisterAiView(view) {
    this.aiSearchViews.delete(view);
  }
  openSearchSettings() {
    const setting = this.app.setting;
    setting.open();
    setting.openTabById(this.manifest.id);
  }
  searchModalClosed(modal) {
    if (this.searchModal === modal) this.searchModal = null;
  }
};
