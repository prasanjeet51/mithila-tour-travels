const path = require('path');
const { build } = require('../scripts/build.js');

module.exports = async () => {
  build({ outDir: path.join(__dirname, '..', '.test-dist'), bookingEndpoint: 'https://bookings.test/hook' });
};
