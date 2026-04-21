export type CliBuildPlan = {
  currentState: {
    version: number;
    cli: { hash: string } | null;
    image: { hash: string } | null;
    vendor: {
      entries: Record<string, string>;
      builds: Record<string, string>;
    };
  };
  nextState: {
    version: number;
    cli: { hash: string } | null;
    image: { hash: string } | null;
    vendor: {
      entries: Record<string, string>;
      builds: Record<string, string>;
    };
  };
  hash: string;
  needsBuild: boolean;
};

export type VendorBuildPlan = {
  currentState: {
    version: number;
    cli: { hash: string } | null;
    image: { hash: string } | null;
    vendor: {
      entries: Record<string, string>;
      builds: Record<string, string>;
    };
  };
  nextState: {
    version: number;
    cli: { hash: string } | null;
    image: { hash: string } | null;
    vendor: {
      entries: Record<string, string>;
      builds: Record<string, string>;
    };
  };
  changedEntries: string[];
  buildServices: string[];
  needsRefresh: boolean;
};

export function readBuildState(): Promise<{
  version: number;
  cli: { hash: string } | null;
  image: { hash: string } | null;
  vendor: {
    entries: Record<string, string>;
    builds: Record<string, string>;
  };
}>;

export function writeBuildState(nextState: {
  version: number;
  cli: { hash: string } | null;
  image: { hash: string } | null;
  vendor: {
    entries: Record<string, string>;
    builds: Record<string, string>;
  };
}): Promise<void>;

export function planCliBuild(packageDir: string): Promise<CliBuildPlan>;

export function planVendorBuild(packageDir: string): Promise<VendorBuildPlan>;

export function planStackImageBuild(packageDir: string): Promise<{
  currentState: {
    version: number;
    cli: { hash: string } | null;
    image: { hash: string } | null;
    vendor: {
      entries: Record<string, string>;
      builds: Record<string, string>;
    };
  };
  nextState: {
    version: number;
    cli: { hash: string } | null;
    image: { hash: string } | null;
    vendor: {
      entries: Record<string, string>;
      builds: Record<string, string>;
    };
  };
  hash: string;
  needsBuild: boolean;
}>;
