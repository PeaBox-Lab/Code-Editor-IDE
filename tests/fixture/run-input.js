const readline = require('node:readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Name? ', (name) => {
  console.log('Hello, ' + name + '! Interactive input works.');
  rl.close();
  process.exit(0);
});
