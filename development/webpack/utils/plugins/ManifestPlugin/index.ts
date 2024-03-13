import { extname } from 'node:path';
import { join } from 'node:path';
import { sources, Compilation, type Compiler } from 'webpack';
import { validate } from 'schema-utils';
import {
  type DeflateOptions,
  Zip,
  AsyncZipDeflate,
  ZipPassThrough,
} from 'fflate';
import { schema } from './schema';
import { ManifestPluginOptions } from './types';

const { RawSource, ConcatSource } = sources;

type Assets = Compilation['assets'];

const NAME = 'ManifestPlugin';

// TODO: it'd be great if the logic to find entry points was also in this plugin
// instead of in helpers.ts.
export class ManifestPlugin<Z extends boolean> {
  /**
   * File types that can be compressed well using DEFLATE compression
   */
  static compressibleFileTypes = new Set([
    '.bmp',
    '.cjs',
    '.css',
    '.csv',
    '.eot',
    '.html',
    '.js',
    '.json',
    '.log',
    '.map',
    '.md',
    '.mjs',
    '.svg',
    '.txt',
    '.wasm',
    '.vtt',
    '.ttf',
    '.wav',
    '.xml',
  ]);

  options: ManifestPluginOptions<Z>;
  constructor(options: ManifestPluginOptions<Z>) {
    validate(schema, options, { name: NAME });
    this.options = options;
  }

  apply(compiler: Compiler) {
    compiler.hooks.compilation.tap(NAME, this.hookIntoAssetPipeline.bind(this));
  }

  async zipAssets(
    compilation: Compilation,
    assets: Assets, // an object of asset names to assets
    options: ManifestPluginOptions<true>,
  ): Promise<void> {
    // TODO: this zips (and compresses) every file individually for each browser
    // can we share the compression and crc steps to save time
    const { browsers, zipOptions } = options;
    const { excludeExtensions, level, outFilePath, mtime } = zipOptions;
    const assetDeletions = new Set<string>(); // Track assets to delete

    // Snapshot the assets to ensure a stable list during processing
    const assetsArray = Object.entries(assets);

    // TODO: we can't run this is parrallel because we'll run out of memory
    // pretty quickly.
    for (const browser of browsers) {
      await new Promise<void>((resolve, reject) => {
        let errored = false;
        const zip = new Zip();

        const source = new ConcatSource();
        zip.ondata = (err, dat, final) => {
          if (err) {
            errored = true;
            return void reject(err);
          }
          source.add(new RawSource(Buffer.from(dat)));

          if (!final) return;

          const zipFilePath = outFilePath.replace(/\[browser\]/gu, browser);
          compilation.emitAsset(zipFilePath, source, {
            javascriptModule: false,
            compressed: true,
            contentType: 'application/zip',
            development: true
          });
          resolve();
        };

        const compressionOptions: DeflateOptions = { level };

        for (const [assetName, asset] of assetsArray) {
          if (errored) return;

          const extName = extname(assetName);
          if (excludeExtensions.includes(extName)) continue;

          assetDeletions.add(assetName);

          const zipFile = ManifestPlugin.compressibleFileTypes.has(extName)
            ? new AsyncZipDeflate(assetName, compressionOptions)
            : new ZipPassThrough(assetName);
          zipFile.mtime = mtime;
          zip.add(zipFile);
          // use a copy of the Buffer, as Zip will consume it
          zipFile.push(Buffer.from(asset.buffer()), true);
        }

        zip.end();
      });
    }

    assetDeletions.forEach((assetName) => compilation.deleteAsset(assetName));
  }

  moveAssets(
    compilation: Compilation,
    assets: Assets,
    options: ManifestPluginOptions<false>,
  ) {
    const browsers = options.browsers;
    for (const assetName in assets) {
      if (!Object.prototype.hasOwnProperty.call(assets, assetName)) {
        continue;
      }
      const asset = assets[assetName];
      // move the assets to the correct browser locations
      browsers.forEach((browser) => {
        compilation.emitAsset(join(browser, assetName), asset);
      });
      compilation.deleteAsset(assetName);
    }
  }

  private hookIntoAssetPipeline(compilation: Compilation) {
    const tapOptions = {
      name: NAME,
      stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_TRANSFER,
    };
    if (this.options.zip) {
      const options: ManifestPluginOptions<true> = this.options;
      compilation.hooks.processAssets.tapPromise(
        tapOptions,
        async (assets: Assets) => this.zipAssets(compilation, assets, options),
      );
    } else {
      const options: ManifestPluginOptions<false> = this.options;
      compilation.hooks.processAssets.tap(tapOptions, (assets: Assets) => {
        this.moveAssets(compilation, assets, options);
      });
    }
  }
}
