const path = require('path');
const moduleAlias = require('module-alias');

// Register path aliases
moduleAlias.addAliases({
  '@': path.resolve(__dirname),
}); 