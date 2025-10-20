// In: netlify/functions/hello-world.js

exports.handler = async (event, context) => {
  console.log("Hello World function executed!"); // Add a log for verification
  return {
    statusCode: 200,
    body: JSON.stringify({ message: "Hello from the test function!" }),
  };
};
