'use strict';
// A small Word file with headings, a theme, a logo, a header and a footer, for template tests.
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const PUB = path.join(__dirname, '..', 'public');
const LOGO = fs.readFileSync(path.join(PUB, 'brand', 'mark-512.png'));

const theme = (maj, min) => `<?xml version="1.0"?><a:theme xmlns:a="a"><a:themeElements><a:clrScheme name="Acme"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="3D1E5C"/></a:dk2><a:lt2><a:srgbClr val="F2EEF7"/></a:lt2><a:accent1><a:srgbClr val="7B2D8E"/></a:accent1><a:accent2><a:srgbClr val="F28C28"/></a:accent2><a:accent3><a:srgbClr val="2BA6A0"/></a:accent3><a:accent4><a:srgbClr val="A0A0A0"/></a:accent4><a:accent5><a:srgbClr val="C8D0D8"/></a:accent5><a:accent6><a:srgbClr val="333333"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink></a:clrScheme><a:fontScheme name="Acme"><a:majorFont><a:latin typeface="${maj}"/></a:majorFont><a:minorFont><a:latin typeface="${min}"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;
async function word(opts) {
  opts = opts || {};
  const w = new JSZip();
  w.file('[Content_Types].xml', '<Types/>');
  w.file('word/theme/theme1.xml', theme('Georgia', 'Verdana'));
  w.file('word/styles.xml', '<w:styles xmlns:w="x"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:color w:val="2B2B2B"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:color w:val="7B2D8E"/><w:sz w:val="40"/></w:rPr></w:style></w:styles>');
  const p = (t) => `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
  w.file('word/document.xml', `<w:document xmlns:w="x"><w:body>${(opts.heads || ['Introduction', 'Scope of Work', 'Project Schedule', 'Risks and Mitigation', 'Commercial Terms']).map(p).join('')}<w:tbl><w:tr><w:tc><w:tcPr><w:shd w:val="clear" w:fill="7B2D8E"/></w:tcPr></w:tc></w:tr></w:tbl></w:body></w:document>`);
  w.file('word/header1.xml', '<w:hdr xmlns:w="x"><w:p><w:r><w:t>Acme Corporation | Confidential</w:t></w:r></w:p></w:hdr>');
  w.file('word/footer1.xml', '<w:ftr xmlns:w="x"><w:p><w:r><w:t>Acme Corporation, Dubai</w:t></w:r></w:p></w:ftr>');
  if (!opts.noLogo) {
    w.file('word/_rels/header1.xml.rels', `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${opts.logoName || 'logo.png'}"/></Relationships>`);
    w.file('word/media/' + (opts.logoName || 'logo.png'), opts.logoBytes || LOGO);
  }
  return w.generateAsync({ type: 'nodebuffer' });
}
module.exports = { word };
