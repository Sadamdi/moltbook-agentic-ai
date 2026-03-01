require('dotenv').config();

require('./server');

const { runAgentLoop } = require('./agentLoop');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  while (true) {
    try {
      const delaySeconds = await runAgentLoop();
      const clamped = Math.max(1, Math.min(60, Number.isFinite(delaySeconds) ? delaySeconds : 30));
      console.log(`Waiting ${clamped} seconds before the next loop...`);
      await sleep(clamped * 1000);
    } catch (err) {
      console.error('Fatal error while running the agent loop:');
      console.error(err.message);
      console.log('Waiting 30 seconds before trying again...');
      await sleep(30_000);
    }
  }
}

main();

