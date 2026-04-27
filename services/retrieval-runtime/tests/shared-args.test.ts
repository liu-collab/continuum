import { describe, expect, it } from "vitest";

import { parseArgs, readLastBooleanArg, readLastIntegerArg, readLastStringArg } from "../src/shared/args.js";

describe("parseArgs", () => {
  it("returns empty collections for empty input", () => {
    expect(parseArgs([])).toEqual({
      options: {},
      positionals: [],
    });
  });

  it("parses long options with separated values", () => {
    expect(parseArgs(["--base-url", "http://localhost:3000", "--timeout-ms", "1000"])).toEqual({
      options: {
        "base-url": "http://localhost:3000",
        "timeout-ms": "1000",
      },
      positionals: [],
    });
  });

  it("parses long options with equals values", () => {
    expect(parseArgs(["--model=gpt-test", "--output-base=docs/report"])).toEqual({
      options: {
        model: "gpt-test",
        "output-base": "docs/report",
      },
      positionals: [],
    });
  });

  it("keeps empty equals values as explicit option values", () => {
    expect(parseArgs(["--prefix=", "--name", "runtime"])).toEqual({
      options: {
        prefix: "",
        name: "runtime",
      },
      positionals: [],
    });
  });

  it("parses boolean flags and no-prefix flags", () => {
    expect(parseArgs(["--update-baseline", "--no-cache"])).toEqual({
      options: {
        "update-baseline": true,
        cache: false,
      },
      positionals: [],
    });
  });

  it("parses short options with separated and equals values", () => {
    expect(parseArgs(["-o", "report.json", "-m=fast"])).toEqual({
      options: {
        o: "report.json",
        m: "fast",
      },
      positionals: [],
    });
  });

  it("parses grouped short boolean options", () => {
    expect(parseArgs(["-abc"])).toEqual({
      options: {
        a: true,
        b: true,
        c: true,
      },
      positionals: [],
    });
  });

  it("collects repeated options in order", () => {
    expect(parseArgs(["--tag", "alpha", "--tag=beta", "--tag", "gamma", "-t", "delta"])).toEqual({
      options: {
        tag: ["alpha", "beta", "gamma"],
        t: "delta",
      },
      positionals: [],
    });
  });

  it("keeps positional arguments and stops option parsing after --", () => {
    expect(parseArgs(["input.txt", "--mode", "fast", "--", "--literal", "tail"])).toEqual({
      options: {
        mode: "fast",
      },
      positionals: ["input.txt", "--literal", "tail"],
    });
  });

  it("allows dash-prefixed scalar values", () => {
    expect(parseArgs(["--offset", "-1"])).toEqual({
      options: {
        offset: "-1",
      },
      positionals: [],
    });
  });

  it("does not treat short options as separated values for long flags", () => {
    expect(parseArgs(["--verbose", "-f"])).toEqual({
      options: {
        verbose: true,
        f: true,
      },
      positionals: [],
    });
  });

  it("keeps negative numbers as scalar values for short and long options", () => {
    expect(parseArgs(["--offset", "-1", "-n", "-2"])).toEqual({
      options: {
        offset: "-1",
        n: "-2",
      },
      positionals: [],
    });
  });

  it("keeps standalone dash and negative numbers as positional arguments", () => {
    expect(parseArgs(["-", "-1"])).toEqual({
      options: {},
      positionals: ["-", "-1"],
    });
  });

  it("allows standalone dash as an explicit option value", () => {
    expect(parseArgs(["--input", "-", "-o", "-"])).toEqual({
      options: {
        input: "-",
        o: "-",
      },
      positionals: [],
    });
  });

  it("keeps malformed empty long options as positional arguments", () => {
    expect(parseArgs(["--", "--literal"])).toEqual({
      options: {},
      positionals: ["--literal"],
    });
    expect(parseArgs(["--=value"])).toEqual({
      options: {},
      positionals: ["--=value"],
    });
  });
});

describe("readLastStringArg", () => {
  it("returns the last string from repeated values", () => {
    expect(readLastStringArg(["alpha", true, "omega"])).toBe("omega");
  });

  it("ignores boolean-only values", () => {
    expect(readLastStringArg(true)).toBeUndefined();
    expect(readLastStringArg([false, true])).toBeUndefined();
  });
});

describe("readLastBooleanArg", () => {
  it("returns the last boolean from repeated values", () => {
    expect(readLastBooleanArg(["alpha", false, true])).toBe(true);
  });

  it("ignores string-only values", () => {
    expect(readLastBooleanArg("true")).toBeUndefined();
    expect(readLastBooleanArg(["alpha", "beta"])).toBeUndefined();
  });
});

describe("readLastIntegerArg", () => {
  it("parses the last string integer value", () => {
    expect(readLastIntegerArg(["1", "20"])).toBe(20);
  });

  it("returns undefined for missing and invalid integers", () => {
    expect(readLastIntegerArg(undefined)).toBeUndefined();
    expect(readLastIntegerArg("not-a-number")).toBeUndefined();
    expect(readLastIntegerArg(true)).toBeUndefined();
  });
});
