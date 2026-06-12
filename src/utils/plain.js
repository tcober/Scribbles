// Strip Vue reactivity (and any non-cloneable proxies) before sending an object
// across the IPC bridge to the main process.
export const plain = (value) => JSON.parse(JSON.stringify(value));
