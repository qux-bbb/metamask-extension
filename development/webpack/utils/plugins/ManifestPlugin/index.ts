import { extname } from 'node:path';
import { readFileSync } from 'node:fs';
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
import { Manifest } from '../../helpers';

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
    // '.ttf', // disable ttf as some of them were getting corrupted when compressed
    '.wav',
    '.xml',
  ]);

  options: ManifestPluginOptions<Z>;
  manifests: Map<string, sources.Source> = new Map();
  constructor(options: ManifestPluginOptions<Z>) {
    validate(schema, options, { name: NAME });
    this.options = options;
    this.manifests = new Map();
  }

  apply(compiler: Compiler) {
    compiler.hooks.compilation.tap(NAME, this.hookIntoAssetPipeline.bind(this));
  }

  async zipAssets(
    compilation: Compilation,
    assets: Assets, // an object of asset names to assets
    options: ManifestPluginOptions<true>,
  ): Promise<void> {
    // TODO: this zips (and compresses) every file individually for each
    // browser. Can we share the compression and crc steps to save time?
    const { browsers, zipOptions } = options;
    const { excludeExtensions, level, outFilePath, mtime } = zipOptions;
    const assetDeletions = new Set<string>(); // Track assets to delete

    // Snapshot the assets to ensure a stable list during processing
    const assetsArray = Object.entries(assets);

    const compressionOptions: DeflateOptions = { level };

    // TODO: we can't run this is parrallel because we'll run out of memory
    // pretty quickly.
    let errored = false;
    for (const browser of browsers) {
      await new Promise<void>((resolve, reject) => {
        const zip = new Zip();

        const source = new ConcatSource();
        zip.ondata = (err, dat, final) => {
          if (err || errored) {
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

        const manifestZipFile = new AsyncZipDeflate("manifest.json", compressionOptions)
        zip.add(manifestZipFile);
        manifestZipFile.push(this.manifests.get(browser)!.buffer(), true);

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
    for (const [name, asset] of Object.entries(assets)) {
      // move the assets to the correct browser locations
      browsers.forEach((browser) => {
        compilation.emitAsset(join(browser, name), asset);
      });
      compilation.deleteAsset(name);
    }
    browsers.forEach((browser) => {
      compilation.emitAsset(join(browser, "manifest.json"), this.manifests.get(browser)!);
    });
  }

  manifesto(compilation: Compilation) {
    // Step 1: Load the base manifest
    const basePath = join(compilation.options.context!, `manifest/v${this.options.manifest_version}/_base.json`);
    let baseManifest: Manifest;
    try {
      baseManifest = JSON.parse(readFileSync(basePath, 'utf-8'));
    } catch (error) {
      throw new Error(`Failed to load base manifest at ${basePath}: ${error}`);
    }

    // Step 2: Merge browser-specific overrides
    this.options.browsers.forEach((browser) => {
      const browserPath = join(compilation.options.context!, `manifest/v${this.options.manifest_version}/${browser}.json`);
      let browserManifest = { ...baseManifest }; // Shallow copy of the base manifest
      browserManifest.version = this.options.version;
      browserManifest.description = this.options.description ? `${baseManifest.description} – ${this.options.description}` : baseManifest.description;

      let browserOverridesFile: string | undefined;
      try {
        browserOverridesFile = readFileSync(browserPath, 'utf-8');
      } catch {
        // ignore if the file didn't exist
      }
      if (browserOverridesFile) {
        const browserOverrides = JSON.parse(readFileSync(browserPath, 'utf-8'));
        browserManifest = { ...browserManifest, ...browserOverrides };
      }

      // Step 3: Deep merge `web_accessible_resources`
      const resources = ['scripts/inpage.js.map', 'scripts/contentscript.js.map'];
      if (compilation.options.devtool === 'source-map') {
        // TODO: merge with anything that might already be in web_accessible_resources
        if (this.options.manifest_version === 3) {
          browserManifest.web_accessible_resources = [
            {
              resources: resources,
              matches: ['<all_urls>'],
            },
          ];
        } else {
          browserManifest.web_accessible_resources = resources;
        }
      }

      // Step 4: Add the manifest file to the `this.manifest` Map
      const source = new RawSource(JSON.stringify(browserManifest, null, 2));
      this.manifests.set(browser, source);
    });
  }

  private hookIntoAssetPipeline(compilation: Compilation) {
    // TODO: generate the manifest file for each browser at some point
    this.manifesto(compilation);


    const tapOptions = {
      name: NAME,
      stage: Infinity,
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
