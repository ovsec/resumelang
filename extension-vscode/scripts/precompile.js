const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');

const themesDir = path.join(__dirname, '..', 'themes');
const outDir = path.join(__dirname, 'compiled');

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const themes = fs.readdirSync(themesDir).filter(d =>
  fs.statSync(path.join(themesDir, d)).isDirectory()
);

for (const theme of themes) {
  const tplPath = path.join(themesDir, theme, 'templates', 'resume.hbs');
  if (!fs.existsSync(tplPath)) continue;

  const source = fs.readFileSync(tplPath, 'utf8');
  const compiled = Handlebars.precompile(source, {
    knownHelpers: {
      join: true,
      eq: true,
      default: true,
      upper: true,
      lower: true,
      ifEquals: true,
      formatDate: true,
    },
    knownHelpersOnly: false,
  });

  const wrapped = `(function(Handlebars){\n${compiled}\n})`;
  const outPath = path.join(outDir, `${theme}.js`);
  fs.writeFileSync(outPath, wrapped, 'utf8');
  console.log(`Precompiled: ${theme}`);
}

console.log('Done.');