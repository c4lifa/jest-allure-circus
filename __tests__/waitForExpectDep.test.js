//const waitForExpect = require("wait-for-expect")

describe("test", () => {
  it("test", async () => {
    await waitForExpect(() => {
      console.log(1);
    });
  });
});