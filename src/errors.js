function mkError (fn) {
  const Constructor = function (message, ...args) {
    this.message = message;

    fn.apply(this, args);

    // Use V8's native method if available, otherwise fallback
    if ("captureStackTrace" in Error) {
      Error.captureStackTrace(this, Constructor);
    } else {
      this.stack = (new Error()).stack;
    }

    return this;
  };
  Object.defineProperty(Constructor, "name", { value: fn.name });
  Constructor.prototype = Object.create(Error.prototype);
  Constructor.prototype.name = fn.name;
  Constructor.prototype.constructor = Constructor;
  return Constructor;
}

export const JSONParseError = mkError(function JSONParseError () {
});

export const CRCValidationError = mkError(function CRCValidationError () {
});

export const HeaderParseError = mkError(function HeaderParseError () {
});

/**
 * Execute a function. If it throws an exception, wrap the
 * exception in a custom exception.
 */
export function wrapFnException (fn, CustomException) {
  return function (...args) {
    try {
      return fn(...args)
    } catch (e) {
      throw new CustomException(e);
    }
  };
}
