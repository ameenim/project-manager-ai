# Browser libraries used for document export

These files are loaded only when a project manager downloads a generated document. They are plain browser bundles, so no install step is needed.

| File | Library | Version | License | Used for |
|---|---|---|---|---|
| docx.min.js | docx (minified from dist/index.umd.cjs) | 9.15.2 | MIT | Word files |
| pptxgen.bundle.js | PptxGenJS (bundle with JSZip) | 4.0.1 | MIT | PowerPoint files |
| exceljs.min.js | ExcelJS | 4.4.0 | MIT | Excel files |

To update a file, install the package in a scratch folder and copy the matching file from its dist folder. Minify docx with esbuild.
