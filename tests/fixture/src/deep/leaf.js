// Nested fixture file used to prove recursive folder loading works.
// search marker is also present here.
function greet(name) {
  return `Hello, ${name}!`;
}

module.exports = { greet };
