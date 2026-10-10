const fs = require('fs');
const path = require('path');

function checkDir(dir) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) checkDir(full);
    else if (f.endsWith('.jsx')) {
      const code = fs.readFileSync(full, 'utf8');
      const lucideMatches = code.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/g);
      const imported = new Set();
      for (const lm of lucideMatches) {
        lm[1].split(',').map(s => s.trim()).filter(Boolean).forEach(i => imported.add(i));
      }
      const jsxMatches = code.matchAll(/<([A-Z][A-Za-z0-9_]+)\b/g);
      for (const m of jsxMatches) {
        const name = m[1];
        if (!imported.has(name)) {
          const isDeclared = new RegExp(`(?:function\\s+${name}|const\\s+${name}\\b|let\\s+${name}\\b|var\\s+${name}\\b|import\\s+${name}\\b|class\\s+${name}\\b|import\\s*\\{[^}]*\\b${name}\\b[^}]*\\})`).test(code);
          if (!isDeclared) {
            console.log(`MISSING IMPORT: ${f} -> <${name} />`);
          }
        }
      }
    }
  }
}
checkDir('frontend/src');
console.log('Check finished.');
