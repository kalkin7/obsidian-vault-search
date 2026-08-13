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
    Utils.prototype.writeFileTo = function(path4, content, overwrite, attr) {
      const self = this;
      if (self.fs.existsSync(path4)) {
        if (!overwrite) return false;
        var stat = self.fs.statSync(path4);
        if (stat.isDirectory()) {
          return false;
        }
      }
      var folder = pth.dirname(path4);
      if (!self.fs.existsSync(folder)) {
        self.makeDir(folder);
      }
      var fd;
      try {
        fd = self.fs.openSync(path4, "w", 438);
      } catch (e) {
        self.fs.chmodSync(path4, 438);
        fd = self.fs.openSync(path4, "w", 438);
      }
      if (fd) {
        try {
          self.fs.writeSync(fd, content, 0, content.length, 0);
        } finally {
          self.fs.closeSync(fd);
        }
      }
      self.fs.chmodSync(path4, attr || 438);
      return true;
    };
    Utils.prototype.writeFileToAsync = function(path4, content, overwrite, attr, callback) {
      if (typeof attr === "function") {
        callback = attr;
        attr = void 0;
      }
      const self = this;
      self.fs.exists(path4, function(exist) {
        if (exist && !overwrite) return callback(false);
        self.fs.stat(path4, function(err, stat) {
          if (exist && stat.isDirectory()) {
            return callback(false);
          }
          var folder = pth.dirname(path4);
          self.fs.exists(folder, function(exists) {
            if (!exists) self.makeDir(folder);
            self.fs.open(path4, "w", 438, function(err2, fd) {
              if (err2) {
                self.fs.chmod(path4, 438, function() {
                  self.fs.open(path4, "w", 438, function(err3, fd2) {
                    self.fs.write(fd2, content, 0, content.length, 0, function() {
                      self.fs.close(fd2, function() {
                        self.fs.chmod(path4, attr || 438, function() {
                          callback(true);
                        });
                      });
                    });
                  });
                });
              } else if (fd) {
                self.fs.write(fd, content, 0, content.length, 0, function() {
                  self.fs.close(fd, function() {
                    self.fs.chmod(path4, attr || 438, function() {
                      callback(true);
                    });
                  });
                });
              } else {
                self.fs.chmod(path4, attr || 438, function() {
                  callback(true);
                });
              }
            });
          });
        });
      });
    };
    Utils.prototype.findFiles = function(path4) {
      const self = this;
      function findSync(dir, pattern, recursive) {
        if (typeof pattern === "boolean") {
          recursive = pattern;
          pattern = void 0;
        }
        let files = [];
        self.fs.readdirSync(dir).forEach(function(file) {
          const path5 = pth.join(dir, file);
          const stat = self.fs.statSync(path5);
          if (!pattern || pattern.test(path5)) {
            files.push(pth.normalize(path5) + (stat.isDirectory() ? self.sep : ""));
          }
          if (stat.isDirectory() && recursive) files = files.concat(findSync(path5, pattern, recursive));
        });
        return files;
      }
      return findSync(path4, void 0, true);
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
    Utils.canonical = function(path4) {
      if (!path4) return "";
      const safeSuffix = pth.posix.normalize("/" + path4.split("\\").join("/"));
      return pth.join(".", safeSuffix);
    };
    Utils.zipnamefix = function(path4) {
      if (!path4) return "";
      const safeSuffix = pth.posix.normalize("/" + path4.split("\\").join("/"));
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
        var path4 = pth.normalize(pth.join(prefix, parts.slice(i, l).join(pth.sep)));
        if (path4 === prefix || path4.startsWith(prefix + pth.sep)) {
          return path4;
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
    module2.exports = function(path4, { fs }) {
      var _path = path4 || "", _obj = newAttr(), _stat = null;
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
        const { join: join4, normalize, sep } = pth.posix;
        return join4(pth.isAbsolute(zipPath) ? "/" : ".", normalize(sep + zipPath.split("\\").join(sep) + sep));
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
var import_obsidian5 = require("obsidian");
var path3 = __toESM(require("path"));

// src/backend-manager.ts
var import_child_process = require("child_process");
var import_fs = require("fs");
var import_promises = require("fs/promises");
var path2 = __toESM(require("path"));
var import_adm_zip = __toESM(require_adm_zip());
var import_obsidian = require("obsidian");

// src/constants.ts
var PROTOCOL_VERSION = 1;
var BACKEND_VERSION = "0.1.4";
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
  "koe5": {
    name: "KoE5 (\uD55C\uAD6D\uC5B4 \uD2B9\uD654, \uACE0\uC790\uC6D0)",
    modelId: "nlpai-lab/KoE5",
    queryPrefix: "query: ",
    documentPrefix: "passage: ",
    note: "\uD55C\uAD6D\uC5B4 \uD2B9\uD654 \uBAA8\uB378. \uC57D 2.3GB \uBA54\uBAA8\uB9AC\uC785\uB2C8\uB2E4."
  },
  "custom": {
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
  excludeGlobs: [".obsidian/**", "9_System/**", "**/node_modules/**"],
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
  modelIdleTimeoutSeconds: 0
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
var path = __toESM(require("path"));
function canonicalVaultPath(vaultPath) {
  const normalized = path.resolve(vaultPath).replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
function vaultId(vaultPath) {
  return (0, import_crypto2.createHash)("sha256").update(canonicalVaultPath(vaultPath), "utf8").digest("hex").slice(0, 20);
}
function localDataRoot() {
  const root = process.env.LOCALAPPDATA || path.join(process.env.HOME || process.cwd(), ".local", "share");
  return path.join(root, "ObsidianVaultSearch");
}
function vaultDataDir(vaultPath) {
  return path.join(localDataRoot(), "vaults", vaultId(vaultPath));
}

// src/backend-manager.ts
var BackendManager = class {
  constructor(vaultPath, pluginDir, getSettings, statusChanged, manifestVersion = BACKEND_VERSION) {
    this.vaultPath = vaultPath;
    this.pluginDir = pluginDir;
    this.getSettings = getSettings;
    this.statusChanged = statusChanged;
    this.manifestVersion = manifestVersion;
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
    return path2.join(this.dataDir, "runtime.json");
  }
  get configPath() {
    return path2.join(this.dataDir, "service-config.json");
  }
  get machinePath() {
    return path2.join(this.dataDir, "machine.json");
  }
  get backendRoot() {
    return path2.join(this.pluginDir, "backend");
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
      return JSON.parse(await (0, import_promises.readFile)(this.machinePath, "utf8"));
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
      config.runtimes = { ...config.runtimes || {}, [kind]: pythonExecutable };
    });
  }
  async updateMachineConfig(change) {
    const operation = this.machineWrite.then(async () => {
      await (0, import_promises.mkdir)(this.dataDir, { recursive: true });
      const config = await this.readMachineConfig();
      change(config);
      const suffix = `${process.pid}.${Date.now()}`;
      const temp = `${this.machinePath}.${suffix}.tmp`;
      const backup = `${this.machinePath}.${suffix}.backup`;
      await (0, import_promises.writeFile)(temp, JSON.stringify(config, null, 2), "utf8");
      let backedUp = false;
      try {
        if ((0, import_fs.existsSync)(this.machinePath)) {
          await (0, import_promises.rename)(this.machinePath, backup);
          backedUp = true;
        }
        await (0, import_promises.rename)(temp, this.machinePath);
        if (backedUp) await (0, import_promises.rm)(backup, { force: true });
      } catch (error) {
        await (0, import_promises.rm)(temp, { force: true }).catch(() => void 0);
        if (backedUp && !(0, import_fs.existsSync)(this.machinePath)) await (0, import_promises.rename)(backup, this.machinePath);
        throw error;
      }
    });
    this.machineWrite = operation.catch(() => void 0);
    return operation;
  }
  async inspectPython(pythonExecutable) {
    const code = [
      "import importlib.util,json,sys,torch,vault_search",
      "required=['transformers','tokenizers','sentence_transformers','kiwipiepy','usearch','numpy','onnxruntime']",
      "assert all(importlib.util.find_spec(name) for name in required)",
      "print(json.dumps({'base':sys._base_executable,'torch':torch.__version__,'backend':vault_search.__version__,'cuda_build':torch.version.cuda,'cuda_available':torch.cuda.is_available(),'device_name':torch.cuda.get_device_name(0) if torch.cuda.is_available() else None}))"
    ].join(";");
    try {
      const stdout = await this.execFileText(pythonExecutable, ["-X", "utf8", "-c", code], 15e3);
      const value = JSON.parse(stdout.trim());
      if (String(value.backend || "") !== BACKEND_VERSION) return null;
      return {
        pythonExecutable,
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
      await this.execFileText("nvidia-smi.exe", ["--query-gpu=name", "--format=csv,noheader"], 1e4);
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
    const script = path2.join(this.backendRoot, "setup-runtime.ps1");
    if (!(0, import_fs.existsSync)(script)) throw new Error(`Runtime installer is missing: ${script}`);
    const executable = await new Promise((resolve3, reject) => {
      const child = (0, import_child_process.spawn)("powershell.exe", [
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
      ], { cwd: this.pluginDir, windowsHide: true, shell: false, env: { ...process.env, PYTHONUTF8: "1" } });
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
        if (code !== 0) reject(new Error(stderr.trim() || `Runtime installer exited with code ${code}`));
        else resolve3(stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || "");
      });
    });
    const info = await this.inspectPython(executable);
    if (!info) throw new Error("Installed runtime validation failed");
    if (kind === "cuda" && !info.cudaAvailable) {
      throw new Error("CUDA runtime was installed, but CUDA is not available to PyTorch. Check the NVIDIA driver.");
    }
    await this.writeManagedRuntime(kind, executable);
    return info;
  }
  execFileText(executable, args, timeout) {
    return new Promise((resolve3, reject) => {
      (0, import_child_process.execFile)(
        executable,
        args,
        { timeout, windowsHide: true, encoding: "utf8" },
        (error, stdout) => error ? reject(error) : resolve3(stdout)
      );
    });
  }
  async readBackendVersion() {
    try {
      const content = await (0, import_promises.readFile)(path2.join(this.backendRoot, "vault_search", "__init__.py"), "utf8");
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
      this.backendProvision = this.provisionBackendFiles(opts.force ?? false).finally(() => {
        this.backendProvision = null;
      });
    }
    return this.backendProvision;
  }
  async provisionBackendFiles(force) {
    const current = await this.readBackendVersion();
    if (!force && current === this.manifestVersion) return true;
    const existing = path2.join(this.pluginDir, "backend");
    if (!(0, import_fs.existsSync)(existing)) {
      const backups = await (0, import_promises.readdir)(this.pluginDir).catch(() => []);
      const candidates = backups.filter((n) => n.startsWith("backend.bak.")).sort();
      for (const name of candidates.reverse()) {
        const backupPath = path2.join(this.pluginDir, name);
        try {
          await (0, import_promises.rename)(backupPath, existing);
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
      throw new Error(`\uBC31\uC5D4\uB4DC \uB2E4\uC6B4\uB85C\uB4DC \uC2E4\uD328: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (response.status !== 200) {
      throw new Error(`\uBC31\uC5D4\uB4DC \uB2E4\uC6B4\uB85C\uB4DC \uC2E4\uD328 (HTTP ${response.status}): ${zipUrl}`);
    }
    const zip = new import_adm_zip.default(Buffer.from(response.arrayBuffer));
    const backendEntries = zip.getEntries().filter((e) => e.entryName.startsWith("backend/") && !e.isDirectory);
    if (backendEntries.length === 0) {
      throw new Error("\uB9B4\uB9AC\uC2A4 zip\uC5D0 backend/ \uD3F4\uB354\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4");
    }
    const tempRoot = path2.join(this.pluginDir, `backend.provision-${Date.now()}`);
    const tempBackend = path2.join(tempRoot, "backend");
    try {
      for (const entry of backendEntries) {
        const rel = entry.entryName.slice("backend/".length);
        const dest = path2.resolve(tempBackend, rel);
        const inside = path2.relative(tempBackend, dest);
        if (path2.isAbsolute(rel) || inside === "" || inside.startsWith("..")) {
          throw new Error(`\uC548\uC804\uD558\uC9C0 \uC54A\uC740 zip \uD56D\uBAA9\uC774 \uAC10\uC9C0\uB418\uC5B4 \uC911\uB2E8\uD569\uB2C8\uB2E4: ${entry.entryName}`);
        }
        await (0, import_promises.mkdir)(path2.dirname(dest), { recursive: true });
        await (0, import_promises.writeFile)(dest, entry.getData());
      }
      const backup = path2.join(this.pluginDir, `backend.bak.${Date.now()}`);
      if ((0, import_fs.existsSync)(existing)) await (0, import_promises.rename)(existing, backup);
      try {
        await (0, import_promises.rename)(tempBackend, existing);
      } catch (error) {
        let rollbackError;
        try {
          await (0, import_promises.rename)(backup, existing);
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
      const backups = await (0, import_promises.readdir)(this.pluginDir).catch(() => []);
      for (const name of backups.filter((n) => n.startsWith("backend.bak."))) {
        await (0, import_promises.rm)(path2.join(this.pluginDir, name), { recursive: true, force: true }).catch(() => void 0);
      }
    } finally {
      await (0, import_promises.rm)(tempRoot, { recursive: true, force: true }).catch(() => void 0);
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
    await (0, import_promises.mkdir)(this.dataDir, { recursive: true });
    if (await this.tryAttachStandalone()) return;
    await this.stopStaleRuntime();
    try {
      await this.ensureBackendProvisioned();
    } catch (error) {
      this.setStatus({ state: "error", error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    if (!(0, import_fs.existsSync)(path2.join(this.backendRoot, "vault_search", "__main__.py"))) {
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
    const env = { ...process.env };
    env.PYTHONUTF8 = "1";
    env.PYTHONPATH = this.backendRoot + (env.PYTHONPATH ? path2.delimiter + env.PYTHONPATH : "");
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
    const log = (0, import_fs.createWriteStream)(path2.join(this.dataDir, "backend.log"), { flags: "a" });
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
        this.setStatus({ state: "error", error: `Backend exited: code=${code}, signal=${signal}` });
      } else {
        this.setStatus({ state: "stopped" });
      }
    });
  }
  async waitUntilAvailable(timeoutMs = 1e4) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (this.ownership === "attached") await this.refreshStatus().catch(() => void 0);
      const state = this.statusValue.state;
      if (["idle", "loading_model", "ready", "ready_no_index"].includes(state)) return this.status;
      if (state === "error") throw new Error(this.statusValue.error || "Backend failed");
      await new Promise((resolve3) => setTimeout(resolve3, 100));
    }
    throw new Error("Backend did not start listening");
  }
  async waitUntilReady(timeoutMs = 18e4) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (this.ownership === "attached") await this.refreshStatus().catch(() => void 0);
      const state = this.statusValue.state;
      if (state === "ready" || state === "ready_no_index") return this.status;
      if (state === "error") throw new Error(this.statusValue.error || "Backend failed");
      await new Promise((resolve3) => setTimeout(resolve3, 250));
    }
    throw new Error("Backend model loading timed out");
  }
  async refreshStatus() {
    const runtime = this.runtime || await this.readRuntime();
    if (!runtime) return;
    const response = await requestBackend(runtime, "status", {}, 3e3);
    if (response.ok) {
      this.setStatus({ ...response.data || {}, pid: runtime.pid, port: runtime.port });
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
          (0, import_child_process.execFile)("taskkill.exe", ["/PID", String(installer.pid), "/T", "/F"], () => resolve3());
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
            (0, import_child_process.execFile)("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], () => resolve3());
          });
        }
      }
    }
    try {
      const current = await this.readRuntime();
      if (!current || current.pid === ownedPid) await (0, import_promises.rm)(this.runtimePath, { force: true });
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
    const response = await requestBackend(runtime, method, params, timeoutMs);
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
    await (0, import_promises.writeFile)(temp, JSON.stringify(payload, null, 2), "utf8");
    try {
      await (0, import_promises.rename)(temp, this.configPath);
    } catch {
      await (0, import_promises.rm)(this.configPath, { force: true });
      await (0, import_promises.rename)(temp, this.configPath);
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
      this.setStatus({ progress: `${Number(event.data.chunks || 0)}\uAC1C \uCCAD\uD06C \uC784\uBCA0\uB529 \uC911` });
      return;
    }
    if (event.event === "embedding_finished") {
      this.setStatus({ progress: `${Number(event.data.chunks || 0)}\uAC1C \uCCAD\uD06C \uC784\uBCA0\uB529 \uC644\uB8CC, \uAC80\uC99D \uC911` });
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
      void requestBackend(this.runtime, "heartbeat", {}, 2e3).catch(() => void 0);
    };
    pulse();
    this.heartbeat = setInterval(pulse, 5e3);
  }
  clearHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
  setStatus(status) {
    this.statusValue = { ...this.statusValue, ...status };
    this.statusChanged(this.status);
  }
  async readRuntime() {
    try {
      return JSON.parse(await (0, import_promises.readFile)(this.runtimePath, "utf8"));
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
    if (runtime.backend_version && runtime.backend_version !== this.manifestVersion) return false;
    if (runtime.vault_path && this.vaultPath) {
      const normalized = (value) => value.replace(/\\/g, "/").toLowerCase();
      if (normalized(runtime.vault_path) !== normalized(this.vaultPath)) return false;
    }
    if (!this.pidRunning(runtime.pid)) return false;
    let statusData;
    try {
      const response = await requestBackend(runtime, "status", {}, 2e3);
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
      await (0, import_promises.rm)(this.runtimePath, { force: true }).catch(() => void 0);
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
      throw new Error(`Existing Vault Search backend did not stop: PID ${runtime.pid}`);
    }
    await (0, import_promises.rm)(this.runtimePath, { force: true });
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
var SCOPE_KEYS = ["includeGlobs", "excludeGlobs"];
var RESTART_KEYS = ["pythonExecutable", "modelIdleTimeoutSeconds"];
var HOT_KEYS = [
  "bm25TopK",
  "vectorTopK",
  "finalTopK",
  "rrfK",
  "maxChunksPerFile",
  "titleRrfWeight",
  "prefixFallback"
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
  if (VECTOR_KEYS.some((key) => !equal(current[key], next[key])) || providerChangedForOnnx) return "vectors";
  if (RESTART_KEYS.some((key) => !equal(current[key], next[key]))) return "restart";
  if (SCOPE_KEYS.some((key) => !equal(current[key], next[key]))) return "scope";
  if (HOT_KEYS.some((key) => !equal(current[key], next[key]))) return "hot";
  return equal(current, next) ? "none" : "hot";
}
function cloneSettings(settings) {
  return {
    ...settings,
    includeGlobs: [...settings.includeGlobs],
    excludeGlobs: [...settings.excludeGlobs]
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
    excludeGlobs: settings.excludeGlobs
  };
}
var SETTINGS_VERSION = 1;
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
  settings.settingsVersion = SETTINGS_VERSION;
  return true;
}

// src/settings-tab.ts
var VaultSearchSettingTab = class extends import_obsidian2.PluginSettingTab {
  constructor(owner) {
    super(owner.app, owner);
    this.owner = owner;
  }
  display() {
    const { containerEl } = this;
    const draft = this.owner.draftSettings;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Vault Search Service" });
    const status = this.owner.backend?.status || { state: "stopped" };
    const statusEl = containerEl.createDiv({ cls: "vault-search-status" });
    statusEl.setText([
      `\uC0C1\uD0DC: ${status.state}`,
      status.model_id ? `\uBAA8\uB378: ${status.model_id}` : "",
      status.device ? `\uB514\uBC14\uC774\uC2A4: ${status.device}` : "",
      status.pid ? `PID: ${status.pid} / \uD3EC\uD2B8: ${status.port}` : "",
      status.count_available === false ? "\uC778\uB371\uC2A4 \uAC1C\uC218: \uD655\uC778 \uBD88\uAC00" : status.files !== void 0 ? `\uC778\uB371\uC2A4: \uD30C\uC77C ${status.files}\uAC1C / \uCCAD\uD06C ${status.chunks ?? 0}\uAC1C` : "",
      status.model_load_seconds !== void 0 ? `\uCD5C\uADFC \uBAA8\uB378 \uB85C\uB529: ${status.model_load_seconds}\uCD08` : "",
      status.progress ? `\uC9C4\uD589: ${status.progress}` : "",
      status.pending_recovery_required ? `\uBCF5\uAD6C \uC7AC\uC2DC\uB3C4 \uD544\uC694: ${status.pending_recovery_warning || "pending path journal"}` : "",
      status.index_rebuild_required ? `\uC778\uB371\uC2A4 \uD638\uD658\uC131 \uBB38\uC81C: ${status.recommended_action === "rebuild_vectors" ? "\uBCA1\uD130 \uC7AC\uAD6C\uCD95 \uD544\uC694" : "\uC804\uCCB4 \uC7AC\uAD6C\uCD95 \uD544\uC694"}` : "",
      status.error ? `\uC624\uB958: ${status.error}` : "",
      this.owner.runtimeSummary,
      this.owner.runtimeWarning || ""
    ].filter(Boolean).join("\n"));
    if (status.error) statusEl.addClass("vault-search-error");
    const impact = settingsImpact(this.owner.settings, draft);
    new import_obsidian2.Setting(containerEl).setName("\uC11C\uBE44\uC2A4 \uC81C\uC5B4 \uBC0F \uC124\uC815 \uC801\uC6A9").setDesc(`\uBAA8\uB378\uC740 \uC774 \uBCFC\uD2B8\uC5D0\uC11C\uB9CC \uC0C1\uC8FC\uD569\uB2C8\uB2E4. \uB300\uAE30 \uC911\uC778 \uC124\uC815 \uC601\uD5A5: ${impact}`).addButton((button) => button.setButtonText("\uC2DC\uC791").onClick(async () => {
      try {
        await this.owner.startBackend();
      } catch (error) {
        this.showError(error);
      }
    })).addButton((button) => button.setButtonText("\uC911\uC9C0").onClick(async () => {
      try {
        await this.owner.stopBackend();
      } catch (error) {
        this.showError(error);
      }
    })).addButton((button) => button.setButtonText("\uC124\uC815 \uC801\uC6A9").setCta().onClick(async () => {
      try {
        await this.owner.applyDraftSettings();
      } catch (error) {
        this.showError(error);
      }
    })).addButton((button) => button.setButtonText("\uBCC0\uACBD \uCDE8\uC18C").onClick(() => this.owner.resetDraftSettings()));
    new import_obsidian2.Setting(containerEl).setName("\uC2DC\uC791 \uC815\uCC45").setDesc("\uAE30\uBCF8\uAC12\uC740 \uC5D4\uC9C4\uC5D0 \uB530\uB77C \uC790\uB3D9 \uC870\uC815\uB429\uB2C8\uB2E4: ONNX\uB294 \uCCAB \uAC80\uC0C9 \uC2DC \uB85C\uB4DC, PyTorch\uB294 \uBCFC\uD2B8 \uC5F4 \uB54C \uB85C\uB4DC. \uC5EC\uAE30\uC11C \uC9C1\uC811 \uC120\uD0DD\uD558\uBA74 \uADF8 \uAC12\uC774 \uC720\uC9C0\uB429\uB2C8\uB2E4.").addDropdown((dropdown) => dropdown.addOption("vault-open", "\uBCFC\uD2B8\uB97C \uC5F4 \uB54C \uBAA8\uB378 \uB85C\uB4DC").addOption("first-search", "\uCCAB \uAC80\uC0C9 \uB54C \uBAA8\uB378 \uB85C\uB4DC").addOption("manual", "\uC218\uB3D9 \uC2DC\uC791").setValue(draft.loadPolicy).onChange((value) => {
      draft.loadPolicy = value;
      this.display();
    }));
    new import_obsidian2.Setting(containerEl).setName("\uC720\uD734 \uBAA8\uB378 \uC5B8\uB85C\uB4DC (\uCD08)").setDesc("0\uC774\uBA74 \uBE44\uD65C\uC131(\uB85C\uB4DC \uD6C4 \uC0C1\uC8FC). \uAC80\uC0C9\uC774 \uC5C6\uC73C\uBA74 \uC774 \uC2DC\uAC04 \uD6C4 \uBAA8\uB378\uC744 \uC5B8\uB85C\uB4DC\uD569\uB2C8\uB2E4. ONNX \uC5D4\uC9C4\uC740 ORT \uC138\uC158\uC744 \uD574\uC81C\uD574 VRAM/RAM\uC744 \uBC18\uD658\uD558\uACE0, \uB2E4\uC74C \uAC80\uC0C9 \uC2DC \uB2E4\uC2DC \uB85C\uB4DC\uD569\uB2C8\uB2E4. PyTorch \uC5D4\uC9C4\uC740 \uCC38\uC870\uB97C \uD574\uC81C\uD558\uB418 CUDA \uCE90\uC2DC\uB85C VRAM \uC77C\uBD80\uAC00 \uB0A8\uC744 \uC218 \uC788\uC2B5\uB2C8\uB2E4.").addText((text) => text.setValue(String(draft.modelIdleTimeoutSeconds)).onChange((value) => {
      draft.modelIdleTimeoutSeconds = this.nonnegativeNumber(value, draft.modelIdleTimeoutSeconds);
    }));
    new import_obsidian2.Setting(containerEl).setName("Python \uC2E4\uD589 \uD30C\uC77C").setDesc("\uC804\uC6A9 venv\uC758 python.exe\uB97C \uAD8C\uC7A5\uD569\uB2C8\uB2E4.").addText((text) => text.setValue(draft.pythonExecutable).setPlaceholder("python").onChange((value) => {
      draft.pythonExecutable = value.trim() || "python";
    }));
    new import_obsidian2.Setting(containerEl).setName("Python \uBC31\uC5D4\uB4DC").setDesc("BRAT \uC124\uCE58\uB294 main.js/manifest/styles.css\uB9CC \uB123\uC73C\uBBC0\uB85C, \uBC31\uC5D4\uB4DC\uB294 GitHub \uB9B4\uB9AC\uC2A4\uC5D0\uC11C \uC790\uB3D9\uC73C\uB85C \uBC1B\uC2B5\uB2C8\uB2E4. \uC774 \uBC84\uD2BC\uC73C\uB85C \uB2E4\uC2DC \uBC1B\uAC70\uB098 \uBC84\uC804\uC744 \uB9DE\uCDA5\uB2C8\uB2E4.").addButton((button) => button.setButtonText("\uBC31\uC5D4\uB4DC \uC124\uCE58/\uBCF5\uAD6C").onClick(async () => {
      try {
        await this.owner.provisionBackend();
      } catch (error) {
        this.showError(error);
      }
    }));
    new import_obsidian2.Setting(containerEl).setName("\uC784\uBCA0\uB529 \uBAA8\uB378").addDropdown((dropdown) => {
      for (const [id, profile] of Object.entries(MODEL_PROFILES)) dropdown.addOption(id, profile.name);
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
    new import_obsidian2.Setting(containerEl).setName("\uBAA8\uB378 ID").setDesc(MODEL_PROFILES[draft.modelProfile]?.note || "Sentence Transformers \uBAA8\uB378 ID").addText((text) => text.setValue(draft.modelId).onChange((value) => {
      draft.modelId = value.trim();
    }));
    new import_obsidian2.Setting(containerEl).setName("\uC784\uBCA0\uB529 \uBC31\uC5D4\uB4DC").setDesc("ONNX Runtime(\uAE30\uBCF8): \uC9C1\uC811 ONNX \uACBD\uB85C\uB85C \uC2DC\uC791\uC774 \uBE60\uB974\uACE0 \uC720\uD734 \uC2DC VRAM/RAM\uC744 \uD574\uC81C\uD569\uB2C8\uB2E4. GPU\uAC00 \uC788\uC73C\uBA74 TensorRT/CUDA\uB97C, \uC5C6\uC73C\uBA74 CPU\uB97C \uC790\uB3D9 \uC0AC\uC6A9\uD569\uB2C8\uB2E4. PyTorch: \uBC8C\uD06C \uC778\uB371\uC2F1\uC774 \uAC00\uC7A5 \uBE60\uB974\uC9C0\uB9CC \uC2DC\uC791\uC774 \uB290\uB9BD\uB2C8\uB2E4. \uBC31\uC5D4\uB4DC\uB97C \uBC14\uAFB8\uBA74 \uC2DC\uC791 \uC815\uCC45 \uAE30\uBCF8\uAC12\uB3C4 \uD568\uAED8 \uC870\uC815\uB429\uB2C8\uB2E4.").addDropdown((dropdown) => dropdown.addOption("onnx", "ONNX Runtime (\uAE30\uBCF8, \uAD8C\uC7A5)").addOption("pytorch", "PyTorch").setValue(draft.engine).onChange((value) => {
      const previous = draft.engine;
      draft.engine = value;
      if (draft.loadPolicy === defaultLoadPolicy(previous)) {
        draft.loadPolicy = defaultLoadPolicy(draft.engine);
      }
      this.display();
    }));
    containerEl.createEl("h3", { text: "\uACE0\uAE09 \uC124\uC815" });
    new import_obsidian2.Setting(containerEl).setName("\uB514\uBC14\uC774\uC2A4").setDesc("\uC790\uB3D9(\uAE30\uBCF8)\uC740 GPU\uC640 \uAC80\uC99D\uB41C CUDA \uB7F0\uD0C0\uC784\uC774 \uC788\uC73C\uBA74 GPU\uB97C, \uC5C6\uC73C\uBA74 CPU\uB97C \uC0AC\uC6A9\uD569\uB2C8\uB2E4. CUDA\uB97C \uBA85\uC2DC\uD558\uBA74 \uB300\uC6A9\uB7C9 \uB7F0\uD0C0\uC784 \uB2E4\uC6B4\uB85C\uB4DC\uAC00 \uD544\uC694\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.").addDropdown((dropdown) => dropdown.addOption("auto", "\uC790\uB3D9").addOption("cpu", "CPU").addOption("cuda", "CUDA").setValue(draft.device).onChange((value) => {
      draft.device = value;
    }));
    const caps = status.capabilities;
    if (draft.engine === "onnx" && caps && caps.derived_model_available === false) {
      new import_obsidian2.Setting(containerEl).setName("ONNX \uD30C\uC0DD \uBAA8\uB378 \uC900\uBE44").setDesc(caps.model_available === false ? "e5-base \uBAA8\uB378 \uC2A4\uB0C5\uC0F7\uC774 \uB85C\uCEEC\uC5D0 \uC5C6\uC2B5\uB2C8\uB2E4. \uBA3C\uC800 intfloat/multilingual-e5-base\uB97C \uBC1B\uC544 \uC8FC\uC138\uC694." : "\uB85C\uCEEC \uC2A4\uB0C5\uC0F7\uC5D0 \uD30C\uC0DD \uD480\uB9C1 \uADF8\uB798\uD504(onnx/model-pooled-normalized.onnx)\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4. \uC0DD\uC131\uC744 \uC2E4\uD589\uD558\uBA74 ONNX \uC5D4\uC9C4\uC744 \uC0AC\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.").addButton((button) => {
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
    if (caps?.cuda_available) providerOptions.push(["cuda", "CUDA"]);
    if (caps?.tensorrt_available) providerOptions.push(["tensorrt", "TensorRT"]);
    const supported = caps ? [caps.cuda_available && "CUDA", caps.tensorrt_available && "TensorRT"].filter(Boolean).join(", ") || "CPU\uB9CC" : "\uC11C\uBE44\uC2A4 \uC2DC\uC791 \uD6C4 \uD655\uC778";
    const providerValue = providerOptions.some(([value]) => value === draft.provider) ? draft.provider : "auto";
    new import_obsidian2.Setting(containerEl).setName("ONNX \uC2E4\uD589 \uC81C\uACF5\uC790 (provider)").setDesc(`CUDA\uC5D0\uC11C\uB9CC \uC0AC\uC6A9\uB429\uB2C8\uB2E4. \uC774 \uBA38\uC2E0 \uC9C0\uC6D0: ${supported}. auto\uB294 TensorRT\uAC00 \uC124\uCE58\uB418\uC5B4 \uC788\uC73C\uBA74 \uC6B0\uC120\uD558\uACE0, \uC544\uB2C8\uBA74 CUDA\uB85C \uD3F4\uBC31\uD569\uB2C8\uB2E4.`).addDropdown((dropdown) => {
      for (const [value, label] of providerOptions) dropdown.addOption(value, label);
      dropdown.setValue(providerValue).setDisabled(draft.engine !== "onnx" || draft.device !== "cuda").onChange((value) => {
        draft.provider = value;
      });
    });
    new import_obsidian2.Setting(containerEl).setName("CUDA \uB7F0\uD0C0\uC784").setDesc("NVIDIA GPU\uC6A9 PyTorch\uC640 onnxruntime-gpu\uB97C \uBCC4\uB3C4 \uC124\uCE58\uD569\uB2C8\uB2E4. \uC218 GB \uB2E4\uC6B4\uB85C\uB4DC\uC640 \uBCA1\uD130 \uC7AC\uAD6C\uCD95\uC73C\uB85C \uC218 \uBD84 \uC774\uC0C1 \uAC78\uB9B4 \uC218 \uC788\uC2B5\uB2C8\uB2E4.").addButton((button) => button.setButtonText("CUDA \uB7F0\uD0C0\uC784 \uC124\uCE58").onClick(async () => {
      try {
        await this.owner.installCudaRuntime();
      } catch (error) {
        this.showError(error);
      }
    }));
    new import_obsidian2.Setting(containerEl).setName("\uC784\uBCA0\uB529 \uC815\uADDC\uD654").addToggle((toggle) => toggle.setValue(draft.normalizeEmbeddings).onChange((value) => {
      draft.normalizeEmbeddings = value;
    }));
    new import_obsidian2.Setting(containerEl).setName("Query prefix").addText((text) => text.setValue(draft.queryPrefix).onChange((value) => {
      draft.queryPrefix = value;
    }));
    new import_obsidian2.Setting(containerEl).setName("Document prefix").addText((text) => text.setValue(draft.documentPrefix).onChange((value) => {
      draft.documentPrefix = value;
    }));
    new import_obsidian2.Setting(containerEl).setName("Include globs").setDesc("\uBCFC\uD2B8 \uC0C1\uB300 \uACBD\uB85C, \uD55C \uC904\uC5D0 \uD558\uB098").addTextArea((area) => {
      area.setValue(draft.includeGlobs.join("\n"));
      area.inputEl.rows = 7;
      area.onChange((value) => {
        draft.includeGlobs = this.lines(value);
      });
    });
    new import_obsidian2.Setting(containerEl).setName("Exclude globs").setDesc("\uBCFC\uD2B8 \uC0C1\uB300 \uACBD\uB85C, \uD55C \uC904\uC5D0 \uD558\uB098").addTextArea((area) => {
      area.setValue(draft.excludeGlobs.join("\n"));
      area.inputEl.rows = 7;
      area.onChange((value) => {
        draft.excludeGlobs = this.lines(value);
      });
    });
    new import_obsidian2.Setting(containerEl).setName("\uC778\uB371\uC2A4 \uAD00\uB9AC").setDesc("\uC124\uC815 \uC801\uC6A9 \uD6C4 \uBC94\uC704\uB97C \uD655\uC778\uD558\uC138\uC694. \uC7AC\uAD6C\uCD95\uC740 \uC784\uC2DC \uD30C\uC77C \uAC80\uC99D \uD6C4 \uC6D0\uC790\uC801\uC73C\uB85C \uAD50\uCCB4\uB429\uB2C8\uB2E4.").addButton((button) => button.setButtonText("\uBC94\uC704 \uBBF8\uB9AC\uBCF4\uAE30").onClick(async () => {
      try {
        const result = await this.owner.previewScope();
        new import_obsidian2.Notice(`\uAC80\uC0C9 \uB300\uC0C1: ${result.count}\uAC1C \uD30C\uC77C`);
      } catch (error) {
        this.showError(error);
      }
    })).addButton((button) => button.setButtonText("\uC815\uBC00 \uB300\uC870").onClick(async () => {
      try {
        await this.owner.reconcile("strict");
      } catch (error) {
        this.showError(error);
      }
    })).addButton((button) => button.setButtonText("\uBCA1\uD130 \uC7AC\uAD6C\uCD95").onClick(async () => {
      try {
        await this.owner.rebuildVectors();
      } catch (error) {
        this.showError(error);
      }
    })).addButton((button) => button.setButtonText("\uC804\uCCB4 \uC7AC\uAD6C\uCD95").setWarning().onClick(async () => {
      try {
        await this.owner.rebuildAll();
      } catch (error) {
        this.showError(error);
      }
    }));
    new import_obsidian2.Setting(containerEl).setName("\uCCAD\uD06C \uD06C\uAE30 / \uC624\uBC84\uB7A9").setDesc("\uAC12\uC744 \uBCC0\uACBD\uD558\uBA74 \uC804\uCCB4 \uC778\uB371\uC2A4 \uC7AC\uAD6C\uCD95\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.").addText((text) => text.setValue(String(draft.chunkChars)).onChange((value) => {
      draft.chunkChars = this.positiveNumber(value, draft.chunkChars);
    })).addText((text) => text.setValue(String(draft.chunkOverlap)).onChange((value) => {
      draft.chunkOverlap = this.nonnegativeNumber(value, draft.chunkOverlap);
    }));
    new import_obsidian2.Setting(containerEl).setName("\uCCAD\uD0B9 \uC804\uB7B5").setDesc("Markdown \uAD6C\uC870 \uC778\uC2DD \uC804\uB7B5\uC744 \uD3EC\uD568\uD574 \uBCC0\uACBD \uC2DC \uC804\uCCB4 \uC778\uB371\uC2A4 \uC7AC\uAD6C\uCD95\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.").addDropdown((dropdown) => dropdown.addOption("paragraph-v1", "\uBB38\uB2E8 \uAE30\uBC18 (\uAE30\uBCF8\uAC12)").addOption("markdown-v2", "Markdown \uAD6C\uC870 \uC778\uC2DD").setValue(draft.chunkingStrategy).onChange((value) => {
      draft.chunkingStrategy = value;
      this.display();
    }));
    new import_obsidian2.Setting(containerEl).setName("BM25 / \uBCA1\uD130 / \uCD5C\uC885 \uD6C4\uBCF4 / RRF k").setDesc("\uAC80\uC0C9\uC774 '\uD6C4\uBCF4\uB97C \uB113\uAC8C \uBAA8\uC544 \uC735\uD569\uD55C \uB4A4 \uCD5C\uC885 \uACB0\uACFC\uB9CC \uBC18\uD658'\uD558\uB294 \uB108\uBE44\uB97C \uC870\uC815\uD569\uB2C8\uB2E4. \uAE30\uBCF8\uAC12 80 / 80 / 40\uC740 K_Notes \uACE8\uB4DC\uC14B \uAE30\uC900 recall@40 0.856\uC73C\uB85C \uCE21\uC815\uD574 \uC815\uD55C \uAC12\uC785\uB2C8\uB2E4.").addText((text) => text.setValue(String(draft.bm25TopK)).onChange((value) => {
      draft.bm25TopK = this.positiveNumber(value, draft.bm25TopK);
    })).addText((text) => text.setValue(String(draft.vectorTopK)).onChange((value) => {
      draft.vectorTopK = this.positiveNumber(value, draft.vectorTopK);
    })).addText((text) => text.setValue(String(draft.finalTopK)).onChange((value) => {
      draft.finalTopK = this.positiveNumber(value, draft.finalTopK);
    })).addText((text) => text.setValue(String(draft.rrfK)).onChange((value) => {
      draft.rrfK = this.positiveNumber(value, draft.rrfK);
    }));
    containerEl.createEl("div", {
      cls: "vault-search-setting-hint",
      text: "\u2022 bm25TopK: \uD0A4\uC6CC\uB4DC(BM25)\uB85C \uBF51\uB294 \uD6C4\uBCF4 \uCCAD\uD06C \uC218. \uB113\uD788\uBA74 \uC815\uD655\uD55C \uB2E8\uC5B4\uAC00 \uD769\uC5B4\uC9C4 \uD30C\uC77C\uB3C4 \uB193\uCE58\uC9C0 \uC54A\uC9C0\uB9CC, \uC7A1\uC74C\uC774 \uB298 \uC218 \uC788\uC2B5\uB2C8\uB2E4.\n\u2022 vectorTopK: \uC758\uBBF8(\uC784\uBCA0\uB529) \uC720\uC0AC\uB3C4\uB85C \uBF51\uB294 \uD6C4\uBCF4 \uCCAD\uD06C \uC218. \uB113\uD788\uBA74 \uD45C\uD604\uC774 \uB2EC\uB77C\uB3C4 \uAD00\uB828\uB41C \uD30C\uC77C\uC774 \uD68C\uC218\uB429\uB2C8\uB2E4.\n\u2022 finalTopK: \uCD5C\uC885 \uBC18\uD658 \uACB0\uACFC \uC218. \uC5D0\uC774\uC804\uD2B8\uAC00 \uB113\uAC8C \uC870\uC0AC\uD560 \uB54C\uB294 40\uAC1C \uC815\uB3C4\uAC00 \uC801\uB2F9\uD569\uB2C8\uB2E4.\n\u2022 rrfK: \uC5EC\uB7EC \uCC44\uB110 \uACB0\uACFC\uB97C \uC735\uD569\uD560 \uB54C \uC21C\uC704 \uC810\uC218\uB97C \uD3C9\uD0C4\uD654\uD558\uB294 \uC0C1\uC218\uC785\uB2C8\uB2E4. \uACB0\uACFC\uAC00 \uD55C \uCC44\uB110\uC5D0 \uCE58\uC6B0\uCE58\uBA74 \uC774 \uAC12\uC744 \uC904\uC5EC \uBCF4\uC138\uC694.\n\uBC14\uAFB8\uBA74 \uC2E4\uD589 \uC911 \uC11C\uBE44\uC2A4\uC5D0 \uC989\uC2DC \uBC18\uC601\uB418\uBA70, \uACB0\uACFC\uAC00 \uC774\uC0C1\uD558\uBA74 \uAE30\uBCF8\uAC12\uC73C\uB85C \uB418\uB3CC\uB9AC\uBA74 \uB429\uB2C8\uB2E4."
    });
    new import_obsidian2.Setting(containerEl).setName("\uAC80\uC0C9 \uB2E4\uC591\uC131 / \uC81C\uBAA9 \uAC00\uC911\uCE58").setDesc("\uD30C\uC77C\uB2F9 \uCD5C\uB300 \uCCAD\uD06C \uC218\uC640 \uD30C\uC77C\uBA85\xB7\uACBD\uB85C\xB7\uD5E4\uB529 RRF \uAC00\uC911\uCE58\uC785\uB2C8\uB2E4. \uAE30\uBCF8\uAC12\uC740 1 / 1.0\uC785\uB2C8\uB2E4.").addText((text) => text.setValue(String(draft.maxChunksPerFile)).onChange((value) => {
      draft.maxChunksPerFile = this.positiveNumber(value, draft.maxChunksPerFile);
    })).addText((text) => text.setValue(String(draft.titleRrfWeight)).onChange((value) => {
      draft.titleRrfWeight = this.nonnegativeNumber(value, draft.titleRrfWeight);
    }));
    containerEl.createEl("div", {
      cls: "vault-search-setting-hint",
      text: "\u2022 maxChunksPerFile: \uD55C \uD30C\uC77C\uC774 \uCD5C\uC885 \uACB0\uACFC\uC5D0\uC11C \uCC28\uC9C0\uD560 \uC218 \uC788\uB294 \uCCAD\uD06C \uC218. 1\uC774\uBA74 \uAC01 \uD30C\uC77C\uC740 \uACB0\uACFC 1\uAC1C\uB85C \uC81C\uD55C\uB418\uC5B4 \uB2E4\uB978 \uD30C\uC77C\uB3C4 \uBCFC \uC218 \uC788\uC2B5\uB2C8\uB2E4. \uD55C \uD30C\uC77C\uC758 \uC5EC\uB7EC \uAD6C\uC808\uC744 \uBCF4\uB824\uBA74 \uB298\uB824 \uBCF4\uC138\uC694.\n\u2022 titleRrfWeight: \uD30C\uC77C\uBA85\xB7\uACBD\uB85C\xB7\uD5E4\uB529 \uB9E4\uCE58\uAC00 \uACB0\uACFC \uC21C\uC704\uC5D0 \uBBF8\uCE58\uB294 \uAC00\uC911\uCE58. \uD30C\uC77C \uC81C\uBAA9\uC744 \uC911\uC694\uD558\uAC8C \uC5EC\uAE30\uB824\uBA74 \uC62C\uB9AC\uC138\uC694."
    });
    new import_obsidian2.Setting(containerEl).setName("\uC811\uB450\uC0AC \uAC80\uC0C9 \uD3F4\uBC31").setDesc("\uC815\uD655 BM25 \uACB0\uACFC\uAC00 \uC5C6\uC744 \uB54C \uD1A0\uD070 \uC811\uB450\uC0AC \uAC80\uC0C9\uC73C\uB85C \uD55C \uBC88 \uB354 \uCC3E\uC2B5\uB2C8\uB2E4.").addToggle((toggle) => toggle.setValue(draft.prefixFallback).onChange((value) => {
      draft.prefixFallback = value;
    }));
    new import_obsidian2.Setting(containerEl).setName("\uB3D9\uAE30\uD654 debounce (ms)").addText((text) => text.setValue(String(draft.syncDebounceMs)).onChange((value) => {
      draft.syncDebounceMs = this.positiveNumber(value, draft.syncDebounceMs);
    }));
    new import_obsidian2.Setting(containerEl).setName("\uC790\uB3D9 \uC99D\uBD84 \uB3D9\uAE30\uD654").addToggle((toggle) => toggle.setValue(draft.autoSync).onChange((value) => {
      draft.autoSync = value;
    }));
    new import_obsidian2.Setting(containerEl).setName("\uC2DC\uC791 \uC2DC \uC804\uCCB4 \uB300\uC870").addToggle((toggle) => toggle.setValue(draft.startupReconcile).onChange((value) => {
      draft.startupReconcile = value;
    }));
  }
  lines(value) {
    return value.split(/\r?\n/).map((line) => line.trim().replace(/\\/g, "/")).filter(Boolean);
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
    new import_obsidian2.Notice(`Vault Search \uC624\uB958: ${error instanceof Error ? error.message : String(error)}`, 8e3);
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
  markChanged(path4) {
    if (!path4.toLowerCase().endsWith(".md")) return;
    this.deleted.delete(path4);
    this.changed.add(path4);
    this.schedule();
  }
  markDeleted(path4) {
    if (!path4.toLowerCase().endsWith(".md")) return;
    this.changed.delete(path4);
    this.deleted.add(path4);
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
    for (const path4 of changed) this.changed.delete(path4);
    for (const path4 of deleted) this.deleted.delete(path4);
    try {
      const accepted = await this.flushCallback(changed, deleted);
      if (!accepted) {
        for (const path4 of changed) this.changed.add(path4);
        for (const path4 of deleted) this.deleted.add(path4);
      }
    } catch {
      for (const path4 of changed) this.changed.add(path4);
      for (const path4 of deleted) this.deleted.add(path4);
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
    this.session = new SearchSession((query) => this.search(query), (state) => this.renderState(state));
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

// src/main.ts
var VaultSearchPlugin = class extends import_obsidian5.Plugin {
  draftSettings;
  backend;
  queue;
  settingTab;
  startupPrepared = false;
  startupInProgress = false;
  searchModal = null;
  runtimeChangePromise = null;
  runtimeSummary = "\uB7F0\uD0C0\uC784: \uD655\uC778 \uC804";
  runtimeWarning = null;
  async onload() {
    await this.loadSettings();
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof import_obsidian5.FileSystemAdapter)) {
      new import_obsidian5.Notice("Vault Search Service\uB294 \uB370\uC2A4\uD06C\uD1B1 \uD30C\uC77C\uC2DC\uC2A4\uD15C \uBCFC\uD2B8\uB9CC \uC9C0\uC6D0\uD569\uB2C8\uB2E4.");
      return;
    }
    const vaultPath = adapter.getBasePath();
    const pluginDir = path3.join(vaultPath, this.app.vault.configDir, "plugins", this.manifest.id);
    this.backend = new BackendManager(
      vaultPath,
      pluginDir,
      () => this.settings,
      (status) => this.handleStatus(status),
      this.manifest.version
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
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file instanceof import_obsidian5.TFile) this.queue.markChanged(file.path);
    }));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file instanceof import_obsidian5.TFile) this.queue.markChanged(file.path);
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (file instanceof import_obsidian5.TFile) this.queue.markDeleted(file.path);
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof import_obsidian5.TFile) {
        this.queue.markDeleted(oldPath);
        this.queue.markChanged(file.path);
      }
    }));
    this.settingTab = new VaultSearchSettingTab(this);
    this.addSettingTab(this.settingTab);
    this.registerCommands();
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.loadPolicy === "vault-open") {
        void this.startBackend().catch((error) => new import_obsidian5.Notice(`Vault Search \uC2DC\uC791 \uC2E4\uD328: ${this.errorMessage(error)}`, 1e4));
      } else if (this.settings.loadPolicy === "first-search") {
        void this.startLazyBackend().catch((error) => new import_obsidian5.Notice(`Vault Search \uB300\uAE30 \uC11C\uBE44\uC2A4 \uC2DC\uC791 \uC2E4\uD328: ${this.errorMessage(error)}`, 1e4));
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
    this.settings.includeGlobs = loaded?.includeGlobs || [...DEFAULT_SETTINGS.includeGlobs];
    this.settings.excludeGlobs = loaded?.excludeGlobs || [...DEFAULT_SETTINGS.excludeGlobs];
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
        if (impact === "all") await this.backend.call("rebuild_all", {}, 36e5);
        if (impact === "vectors") await this.backend.call("rebuild_vectors", {}, 36e5);
        if (!previousWasRunning && this.settings.loadPolicy === "manual") await this.backend.stop();
      } else {
        this.settings = next;
        await this.saveSettings();
        if (this.isReady()) {
          await this.backend.call("apply_search_config", hotConfig(next));
          if (impact === "scope") await this.backend.call("reconcile", { mode: "fast" }, 6e5);
        }
      }
      this.draftSettings = cloneSettings(this.settings);
      new import_obsidian5.Notice(impact === "all" ? "\uC124\uC815\uC744 \uC801\uC6A9\uD558\uACE0 \uC804\uCCB4 \uC778\uB371\uC2A4\uB97C \uC7AC\uAD6C\uCD95\uD588\uC2B5\uB2C8\uB2E4." : impact === "vectors" ? "\uC124\uC815\uC744 \uC801\uC6A9\uD558\uACE0 \uBCA1\uD130 \uC778\uB371\uC2A4\uB97C \uC7AC\uAD6C\uCD95\uD588\uC2B5\uB2C8\uB2E4." : "Vault Search \uC124\uC815\uC744 \uC801\uC6A9\uD588\uC2B5\uB2C8\uB2E4.");
    } catch (error) {
      await this.backend.stop().catch(() => void 0);
      this.settings = previous;
      this.draftSettings = cloneSettings(previous);
      await this.saveSettings();
      if (previousWasRunning) {
        await this.backend.start(false);
        await this.backend.waitUntilReady();
      }
      throw error;
    } finally {
      this.settingTab?.display();
    }
  }
  async startBackend() {
    await this.prepareRuntime(this.settings, false);
    await this.backend.start(false);
    await this.backend.waitUntilReady();
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
    if (!await this.backend.hasNvidiaGpu()) {
      throw new Error("NVIDIA GPU \uB610\uB294 \uB4DC\uB77C\uC774\uBC84\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
    }
    if (!await confirmRuntimeInstall(this.app, true)) return;
    const current = await this.backend.inspectPython(this.settings.pythonExecutable);
    const cpu = await this.backend.managedRuntime("cpu");
    const basePython = current?.baseExecutable || cpu?.baseExecutable || "python";
    new import_obsidian5.Notice("CUDA \uB7F0\uD0C0\uC784\uC744 \uC124\uCE58\uD558\uACE0 \uC788\uC2B5\uB2C8\uB2E4. \uC218 \uBD84 \uC774\uC0C1 \uAC78\uB9B4 \uC218 \uC788\uC2B5\uB2C8\uB2E4.", 1e4);
    const installed = await this.backend.installManagedRuntime(
      "cuda",
      basePython,
      (text) => {
        if (text) this.runtimeSummary = `CUDA \uC124\uCE58 \uC911: ${text.split(/\r?\n/).at(-1)}`;
      }
    );
    this.runtimeSummary = `\uB7F0\uD0C0\uC784: CUDA ${installed.cudaBuild || ""} / ${installed.deviceName || "GPU"}`;
    this.runtimeWarning = null;
    if (this.settings.device === "cpu") {
      const active = current || cpu;
      this.runtimeSummary = active ? `\uB7F0\uD0C0\uC784: CPU / PyTorch ${active.torchVersion} (CUDA \uB7F0\uD0C0\uC784 \uC124\uCE58\uB428)` : "\uB7F0\uD0C0\uC784: CPU (CUDA \uB7F0\uD0C0\uC784 \uC124\uCE58\uB428)";
      new import_obsidian5.Notice("CUDA \uB7F0\uD0C0\uC784\uC744 \uC124\uCE58\uD588\uC2B5\uB2C8\uB2E4. \uD604\uC7AC CPU \uBA85\uC2DC \uC124\uC815\uC740 \uC720\uC9C0\uB429\uB2C8\uB2E4.", 1e4);
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
    new import_obsidian5.Notice("CUDA \uB7F0\uD0C0\uC784 \uC124\uCE58\uC640 \uC801\uC6A9\uC744 \uC644\uB8CC\uD588\uC2B5\uB2C8\uB2E4.", 1e4);
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
    const result = await this.backend.call(
      "provision_onnx",
      {},
      6e5
    );
    if (!result.provisioned) throw new Error("ONNX \uD30C\uC0DD \uBAA8\uB378 \uC0DD\uC131 \uC2E4\uD328");
    new import_obsidian5.Notice("ONNX \uD30C\uC0DD \uBAA8\uB378\uC744 \uC0DD\uC131\uD588\uC2B5\uB2C8\uB2E4. \uC11C\uBE44\uC2A4\uB97C \uC7AC\uC2DC\uC791\uD569\uB2C8\uB2E4.", 8e3);
    await this.restartBackend();
  }
  async provisionBackend() {
    await this.backend.stop();
    await this.backend.ensureBackendProvisioned({ force: true });
    new import_obsidian5.Notice("Python \uBC31\uC5D4\uB4DC\uB97C \uC124\uCE58\uD588\uC2B5\uB2C8\uB2E4. \uC11C\uBE44\uC2A4\uB97C \uC7AC\uC2DC\uC791\uD569\uB2C8\uB2E4.", 8e3);
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
    new import_obsidian5.Notice("Vault Search Service\uB97C \uC7AC\uC2DC\uC791\uD588\uC2B5\uB2C8\uB2E4.");
  }
  async previewScope() {
    await this.ensureSearchStarted();
    return this.backend.call("preview_scope", {}, 12e4);
  }
  async reconcile(mode = "strict") {
    await this.ensureSearchStarted();
    const result = await this.backend.call("reconcile", { mode }, 6e5);
    new import_obsidian5.Notice(result.rebuild_required ? `\uC7AC\uAD6C\uCD95 \uD544\uC694: ${result.reason}` : "\uC778\uB371\uC2A4 \uC99D\uBD84 \uB300\uC870\uB97C \uC644\uB8CC\uD588\uC2B5\uB2C8\uB2E4.", 8e3);
    this.settingTab?.display();
  }
  async rebuildAll() {
    await this.ensureSearchStarted();
    new import_obsidian5.Notice("\uC804\uCCB4 \uC778\uB371\uC2A4 \uC7AC\uAD6C\uCD95\uC744 \uC2DC\uC791\uD569\uB2C8\uB2E4. \uBC31\uADF8\uB77C\uC6B4\uB4DC\uC5D0\uC11C \uC9C4\uD589\uB429\uB2C8\uB2E4.");
    const result = await this.backend.call("rebuild_all", {}, 36e5);
    new import_obsidian5.Notice(`\uC804\uCCB4 \uC7AC\uAD6C\uCD95 \uC644\uB8CC: \uD30C\uC77C ${result.files}\uAC1C, \uCCAD\uD06C ${result.chunks}\uAC1C`, 1e4);
    this.settingTab?.display();
  }
  async rebuildVectors() {
    await this.ensureSearchStarted();
    new import_obsidian5.Notice("\uBCA1\uD130 \uC778\uB371\uC2A4 \uC7AC\uAD6C\uCD95\uC744 \uC2DC\uC791\uD569\uB2C8\uB2E4.");
    const result = await this.backend.call("rebuild_vectors", {}, 36e5);
    new import_obsidian5.Notice(`\uBCA1\uD130 \uC7AC\uAD6C\uCD95 \uC644\uB8CC: \uCCAD\uD06C ${result.chunks}\uAC1C`, 1e4);
    this.settingTab?.display();
  }
  registerCommands() {
    this.addCommand({ id: "open-search", name: "Open search", callback: () => this.openSearch() });
    this.addCommand({
      id: "search-selected-text",
      name: "Search selected text",
      editorCallback: (editor) => this.openSearch(selectedTextQuery(editor))
    });
    this.addCommand({ id: "start-service", name: "Start search service", callback: () => void this.startBackend() });
    this.addCommand({ id: "stop-service", name: "Stop search service", callback: () => void this.stopBackend() });
    this.addCommand({ id: "restart-service", name: "Restart search service", callback: () => void this.restartBackend() });
    this.addCommand({ id: "reconcile-index", name: "Reconcile search index", callback: () => void this.reconcile() });
    this.addCommand({ id: "rebuild-index", name: "Rebuild complete search index", callback: () => void this.rebuildAll() });
    this.addCommand({ id: "rebuild-vectors", name: "Rebuild vector index", callback: () => void this.rebuildVectors() });
  }
  async prepareRuntime(target, interactive) {
    const current = await this.backend.inspectPython(target.pythonExecutable);
    const cpu = await this.backend.managedRuntime("cpu");
    const cuda = await this.backend.managedRuntime("cuda");
    const choose = (python, summary) => {
      target.pythonExecutable = python;
      this.runtimeSummary = summary;
      this.runtimeWarning = null;
    };
    const hasGpu = await this.backend.hasNvidiaGpu();
    const selection = selectRuntime(target.device, current, cpu, cuda, hasGpu);
    if (selection.kind === "error") throw new Error(selection.message);
    if (selection.kind === "selected") {
      const selected = selection.runtime;
      choose(selected.pythonExecutable, selected.cudaAvailable ? `\uB7F0\uD0C0\uC784: CUDA ${selected.cudaBuild || ""} / ${selected.deviceName || "GPU"}` : `\uB7F0\uD0C0\uC784: CPU / PyTorch ${selected.torchVersion}`);
      return;
    }
    if (selection.kind === "cpu-fallback" && !interactive) {
      target.pythonExecutable = selection.runtime.pythonExecutable;
      this.runtimeSummary = `\uB7F0\uD0C0\uC784: CPU / PyTorch ${selection.runtime.torchVersion}`;
      this.runtimeWarning = selection.warning;
      return;
    }
    const install = interactive && await confirmRuntimeInstall(this.app, target.device === "cuda");
    if (!install) {
      if (target.device === "cuda") throw new Error(interactive ? "CUDA \uB7F0\uD0C0\uC784 \uC124\uCE58\uAC00 \uCDE8\uC18C\uB418\uC5B4 \uC124\uC815\uC744 \uC801\uC6A9\uD558\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4." : "CUDA \uB7F0\uD0C0\uC784\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uC124\uC815\uC5D0\uC11C CUDA \uB7F0\uD0C0\uC784\uC744 \uBA3C\uC800 \uC124\uCE58\uD574 \uC8FC\uC138\uC694.");
      const selected = selection.kind === "cpu-fallback" ? selection.runtime : cpu || current;
      if (!selected) throw new Error("\uC0AC\uC6A9 \uAC00\uB2A5\uD55C CPU \uAC80\uC0C9 \uB7F0\uD0C0\uC784\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.");
      target.pythonExecutable = selected.pythonExecutable;
      this.runtimeSummary = `\uB7F0\uD0C0\uC784: CPU / PyTorch ${selected.torchVersion}`;
      this.runtimeWarning = "NVIDIA GPU\uAC00 \uAC10\uC9C0\uB410\uC9C0\uB9CC CUDA \uB7F0\uD0C0\uC784\uC774 \uC124\uCE58\uB418\uC9C0 \uC54A\uC544 CPU\uB97C \uC0AC\uC6A9\uD569\uB2C8\uB2E4.";
      return;
    }
    const basePython = current?.baseExecutable || cpu?.baseExecutable || "python";
    try {
      new import_obsidian5.Notice("CUDA \uB7F0\uD0C0\uC784\uC744 \uC124\uCE58\uD558\uACE0 \uC788\uC2B5\uB2C8\uB2E4. \uC218 \uBD84 \uC774\uC0C1 \uAC78\uB9B4 \uC218 \uC788\uC2B5\uB2C8\uB2E4.", 1e4);
      const installed = await this.backend.installManagedRuntime(
        "cuda",
        basePython,
        (text) => {
          if (text) this.runtimeSummary = `CUDA \uC124\uCE58 \uC911: ${text.split(/\r?\n/).at(-1)}`;
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
  }
  handleStatus(status) {
    this.settingTab?.display();
    this.searchModal?.updateBackendStatus(status);
    if (status.state === "ready" || status.state === "ready_no_index") {
      if (this.startupPrepared) void this.queue?.flush();
      else void this.completeStartup();
    }
  }
  async completeStartup() {
    if (this.startupPrepared || this.startupInProgress || !this.isReady()) return;
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
          new import_obsidian5.Notice(`Vault Search \uC778\uB371\uC2A4\uC5D0 \uD638\uD658\uC131 \uBB38\uC81C\uAC00 \uC788\uC2B5\uB2C8\uB2E4. \uC124\uC815\uC5D0\uC11C ${action}\uC744 \uC2E4\uD589\uD558\uC138\uC694.`, 8e3);
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
  async openSearchResult(location) {
    const file = this.app.vault.getAbstractFileByPath(location.path);
    if (!(file instanceof import_obsidian5.TFile)) {
      new import_obsidian5.Notice(`\uD30C\uC77C\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4: ${location.path}`);
      return;
    }
    await this.app.workspace.getLeaf(false).openFile(file, {
      active: true,
      eState: { line: location.line - 1 }
    });
    this.searchModal?.close();
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
