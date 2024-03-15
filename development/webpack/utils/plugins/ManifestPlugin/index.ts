import { extname, join } from 'node:path';
import {
  sources,
  ProgressPlugin,
  type Compilation,
  type Compiler,
  type Asset,
} from 'webpack';
import { validate } from 'schema-utils';
import {
  type DeflateOptions,
  Zip,
  AsyncZipDeflate,
  ZipPassThrough,
} from 'fflate';
import { noop, type Manifest, type ManifestV3, Browser } from '../../helpers';
import { schema } from './schema';
import type { ManifestPluginOptions } from './types';

const { RawSource, ConcatSource } = sources;

type Assets = Compilation['assets'];

const NAME = 'ManifestPlugin';
const BROWSER_TEMPLATE_RE = /\[browser\]/gu;

/**
 * Returns true if the given manifest is a V3 manifest.
 *
 * @param manifest - The manifest to check
 * @returns True if the manifest is a V3 manifest
 */
function isManifestV3(manifest: Manifest): manifest is ManifestV3 {
  return manifest.manifest_version === 3;
}

/**
 * Clones a Buffer or Uint8Array and returns it
 *
 * @param data
 * @returns
 */
function clone(data: Buffer | Uint8Array): Buffer {
  return Buffer.from(data);
}

/**
 * Adds the given asset to the zip file
 *
 * @param asset - The asset to add
 * @param assetName - The name of the asset
 * @param compress - Whether to compress the asset
 * @param compressionOptions - The options to use for compression
 * @param mtime - The modification time of the asset
 * @param zip - The zip file to add the asset to
 */
function addAssetToZip(
  asset: Buffer,
  assetName: string,
  compress: boolean,
  compressionOptions: DeflateOptions | undefined,
  mtime: number,
  zip: Zip,
): void {
  const zipFile = compress
    ? new AsyncZipDeflate(assetName, compressionOptions)
    : new ZipPassThrough(assetName);
  zipFile.mtime = mtime;
  zip.add(zipFile);
  // use a copy of the Buffer, as Zip will consume it
  zipFile.push(asset, true);
}

/**
 * A webpack plugin that generates extension manifests for browsers and organizes
 * assets into browser-specific directories and optionally zips them.
 *
 * TODO: it'd be great if the logic to find entry points was also in this plugin
 * instead of in helpers.ts.
 */
export class ManifestPlugin<Z extends boolean> {
  /**
   * File types that can be compressed well using DEFLATE compression, used when
   * zipping assets.
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
    '.vtt', // very slow to process?
    // ttf is disabled as some were getting corrupted during compression. You
    // can test this by uncommenting it, running with --zip, and then unzipping
    // the resulting zip file. If it is still broken the unzip operation will
    // show an error.
    // '.ttf',
    '.wav',
    '.xml',
  ]);

  options: ManifestPluginOptions<Z>;

  manifests: Map<Browser, sources.Source> = new Map();

  constructor(options: ManifestPluginOptions<Z>) {
    validate(schema, options, { name: NAME });
    this.options = options;
    this.manifests = new Map();
  }

  apply(compiler: Compiler) {
    compiler.hooks.compilation.tap(NAME, this.hookIntoAssetPipeline.bind(this));
  }

  private async zipAssets(
    compilation: Compilation,
    assets: Assets, // an object of asset names to assets
    options: ManifestPluginOptions<true>,
  ): Promise<void> {
    // TODO: this zips (and compresses) every file individually for each
    // browser. Can we share the compression and crc steps to save time?
    const { browsers, zipOptions } = options;
    const { excludeExtensions, level, outFilePath, mtime } = zipOptions;
    const compressionOptions: DeflateOptions = { level };
    const assetsArray = Object.entries(assets);
    // we need to wait to delete assets until after we've zipped them all
    const assetDeletions = new Set<string>();

    let filesProcessed = 0;
    const numAssetsPerBrowser = assetsArray.length + 1;
    const totalWork = numAssetsPerBrowser * browsers.length; // +1 for each browser's manifest.json
    const reportProgress =
      ProgressPlugin.getReporter(compilation.compiler) || noop;
    // TODO: run this in parallel. It you try without optimizing the way we do
    // Zipping they process will likely run out of memory
    for (const browser of browsers) {
      const manifest = this.manifests.get(browser) as sources.Source;
      // since Zipping is async, an past chunk could cause an error after
      // we've started processing additional chunks. We'll use this errored
      // flag to short circuit the rest of the processing if that happens.

      const source = await new Promise<sources.Source>((resolve, reject) => {
        let errored = false;
        const zipSource = new ConcatSource();
        const zip = new Zip((error, data, final) => {
          if (errored) return; // ignore additional errors
          if (error) {
            // set error flag to prevent additional processing
            errored = true;
            reject(error);
          } else {
            zipSource.add(new RawSource(clone(data)));
            // we've received our final bit of data, return the zipSource
            if (final) resolve(zipSource);
          }
        });

        // add the browser's manifest.json file to the zip
        addAssetToZip(
          manifest.buffer(),
          'manifest.json',
          true,
          compressionOptions,
          mtime,
          zip,
        );
        reportProgress(
          0,
          `${++filesProcessed}/${totalWork} assets zipped for ${browser}`,
          'manifest.json',
        );

        for (const [assetName, asset] of assetsArray) {
          if (errored) return;

          const extName = extname(assetName);
          if (excludeExtensions.includes(extName)) continue;

          assetDeletions.add(assetName);

          addAssetToZip(
            // make a copy of the asset Buffer as Zipping will *consume* it,
            // which breaks things if we are compiling for multiple browsers.
            clone(asset.buffer()),
            assetName,
            ManifestPlugin.compressibleFileTypes.has(extName),
            compressionOptions,
            mtime,
            zip,
          );
          reportProgress(
            0,
            `${++filesProcessed}/${totalWork} assets zipped for ${browser}`,
            assetName,
          );
        }

        zip.end();
      });

      // add the zip file to webpack's assets.
      const zipFilePath = outFilePath.replace(BROWSER_TEMPLATE_RE, browser);
      compilation.emitAsset(zipFilePath, source, {
        javascriptModule: false,
        compressed: true,
        contentType: 'application/zip',
        development: true,
      });
    }

    // delete the assets after we've zipped them all
    assetDeletions.forEach((assetName) => compilation.deleteAsset(assetName));
  }

  /**
   * Moves the assets to the correct browser locations and adds each browser's
   * extension manifest.json file to the list of assets.
   *
   * @param compilation
   * @param assets
   * @param options
   */
  private moveAssets(
    compilation: Compilation,
    assets: Assets,
    options: ManifestPluginOptions<false>,
  ): void {
    // we need to wait to delete assets until after we've zipped them all
    const assetDeletions = new Set<string>();
    const { browsers } = options;
    browsers.forEach((browser) => {
      const manifest = this.manifests.get(browser) as sources.Source;
      compilation.emitAsset(join(browser, 'manifest.json'), manifest, {
        javascriptModule: false,
        contentType: 'application/json',
      });
      for (const [name, asset] of Object.entries(assets)) {
        // move the assets to their final browser-relative locations
        const assetDetails = compilation.getAsset(name) as Readonly<Asset>;
        compilation.emitAsset(join(browser, name), asset, assetDetails.info);
        assetDeletions.add(name);
      }
    });
    // delete the assets after we've zipped them all
    assetDeletions.forEach((assetName) => compilation.deleteAsset(assetName));
  }

  private prepareManifests(compilation: Compilation): void {
    const context = compilation.options.context as string;
    const manifestPath = join(
      context,
      `manifest/v${this.options.manifest_version}`,
    );
    // Load the base manifest
    const basePath = join(manifestPath, `_base.json`);
    const baseManifest: Manifest = require(basePath);

    const description = this.options.description
      ? `${baseManifest.description} – ${this.options.description}`
      : baseManifest.description;
    const { version } = this.options;

    this.options.browsers.forEach((browser) => {
      let browserManifest: Manifest = { ...baseManifest, version, description };

      try {
        const browserManifestPath = join(manifestPath, `${browser}.json`);
        // merge browser-specific overrides into the base manifest
        browserManifest = {
          ...browserManifest,
          ...require(browserManifestPath),
        };
      } catch {
        // ignore if the file doesn't exist, as some browsers might not need overrides
      }

      // merge provided `web_accessible_resources`
      const resources = this.options.web_accessible_resources;
      if (resources && resources.length > 0) {
        if (isManifestV3(browserManifest)) {
          browserManifest.web_accessible_resources =
            browserManifest.web_accessible_resources || [];
          const war = browserManifest.web_accessible_resources.find(
            (resource) => resource.matches.includes('<all_urls>'),
          );
          if (war) {
            // merge the resources into the existing <all_urls> resource, ensure uniqueness using `Set`
            war.resources = [...new Set([...war.resources, ...resources])];
          } else {
            // add a new <all_urls> resource
            browserManifest.web_accessible_resources.push({
              matches: ['<all_urls>'],
              resources,
            });
          }
        } else {
          browserManifest.web_accessible_resources = [
            ...resources,
            ...(browserManifest.web_accessible_resources || []),
          ];
        }
      }

      // Add the manifest file to the assets
      const source = new RawSource(JSON.stringify(browserManifest, null, 2));
      this.manifests.set(browser, source);
    });
  }

  private hookIntoAssetPipeline(compilation: Compilation): void {
    // prepare manifests early so we can catch errors early instead of waiting
    // until the end of the compilation.
    this.prepareManifests(compilation);

    const tapOptions = {
      name: NAME,
      stage: Infinity,
    };
    if (this.options.zip) {
      const options = this.options as ManifestPluginOptions<true>;
      compilation.hooks.processAssets.tapPromise(
        tapOptions,
        async (assets: Assets) => this.zipAssets(compilation, assets, options),
      );
    } else {
      const options = this.options as ManifestPluginOptions<false>;
      compilation.hooks.processAssets.tap(tapOptions, (assets: Assets) => {
        this.moveAssets(compilation, assets, options);
      });
    }
  }
}
