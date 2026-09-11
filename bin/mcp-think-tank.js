#!/usr/bin/env node

/**
 * This is the executable entry point for the mcp-think-tank 
 * when installed globally via npm
 */

// Import the console utility immediately to redirect logs
// Note: We can't import from utils/console since the path resolution is different for bin scripts
// So we'll still need this minimal redirect here for the bin script
console.log = (...args) => console.error(...args);

// Handle --version flag directly in the bin script for faster response
if (process.argv.includes('--version')) {
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'));
  console.error(`${pkg.name} v${pkg.version}`);
  process.exit(0);
}

// Import the server module with error handling
import('../dist/server.js').catch(e => { 
  console.error(`Failed to start MCP Think Tank server:`, e); 
  process.exit(1); 
}); 