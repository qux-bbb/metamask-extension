import { Browser } from '../../helpers';

export type ZipOptions = {
  /**
   * Compression level for compressible assets. 0 is no compression, 9 is maximum compression. 6 is default.
   */
  level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  /**
   * Modification time for all files in the zip, specified as a UNIX timestamp (milliseconds since 1 January 1970 UTC). This property sets a uniform modification time for the contents of the zip file. Note: Zip files use FAT file timestamps, which have a limited range. Therefore, datetimes before 1980-01-01 (timestamp value of 315532800000) are invalid in standard Zip files, and datetimes on or after 2100-01-01 (timestamp value of 4102444800000) are also invalid. Values must fall within this range.
   */
  mtime: number;
  /**
   * File extensions to exclude from zip; should include the `.`, e.g., [`.map`].
   */
  excludeExtensions: string[];

  /**
   * File path template for zip file relative to webpack output directory. You must include `[browser]` in the file path template, which will be replaced with the browser name. For example, `builds/[browser].zip`.
   */
  outFilePath: string;
};

export type CommonManifestPluginOptions = {
  /**
   * The browsers to build for.
   */
  browsers: [Browser, ...Browser[]];
};

export type ManifestPluginOptions<Z extends boolean> = Z extends true
  ? {
      /**
       * The browsers to build for.
       */
      browsers: [Browser, ...Browser[]];
      /**
       * Whether or not to zip the individual browser builds.
       */
      zip: true;
      /**
       * Options for the zip.
       */
      zipOptions: Z extends true ? ZipOptions : never;
    }
  : {
      /**
       * The browsers to build for.
       */
      browsers: Readonly<[Browser, ...Browser[]]>;
      /**
       * Whether or not to zip the individual browser builds.
       */
      zip: false;
    };