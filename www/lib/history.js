export function createHistory(limit = 40) {
  const past = [];
  const future = [];

  function remember(list, state) {
    list.push(structuredClone(state));
    if (list.length > limit) list.shift();
  }

  return {
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
    push(state) {
      remember(past, state);
      future.length = 0;
    },
    undo(current) {
      if (past.length === 0) return null;
      future.push(structuredClone(current));
      return past.pop();
    },
    redo(current) {
      if (future.length === 0) return null;
      remember(past, current);
      return future.pop();
    },
    clear() {
      past.length = 0;
      future.length = 0;
    },
  };
}
