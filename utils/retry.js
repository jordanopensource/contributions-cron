/**
 * Util function to return a promise which is resolved in provided milliseconds
 */
function waitFor(millSeconds) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, millSeconds);
  });
}

async function retryPromiseWithDelay(promise, nthTry, delayTime) {
  try {
    const res = await promise;
    return res;
  } catch (e) {
    if (nthTry === 1) {
      return Promise.reject(e);
    }
    console.log("retrying", nthTry, "time");
    // wait for delayTime amount of time before calling this method again
    await waitFor(delayTime);
    return retryPromiseWithDelay(promise, nthTry - 1, delayTime);
  }
}

module.exports = {
  retryPromiseWithDelay,
};
