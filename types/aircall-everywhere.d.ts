// Minimal type shim — the aircall-everywhere package ships without TS
// declarations. We only call `new AircallWorkspace(settings)` plus on/send/
// isLoggedIn/removeListener at runtime; the provider casts internally.
declare module "aircall-everywhere" {
  type Settings = {
    onLogin?: (settings: any) => void;
    onLogout?: () => void;
    integrationToLoad?: "zendesk" | "hubspot";
    domToLoadWorkspace: string;
    size?: "big" | "small" | "auto";
    debug?: boolean;
  };
  export default class AircallWorkspace {
    constructor(settings: Settings);
    on(event: string, cb: (data: any) => void): void;
    send(event: string, payload?: any, cb?: (success: boolean, data: any) => void): void;
    isLoggedIn(cb: (loggedIn: boolean) => void): void;
    removeListener(event: string, cb: (data: any) => void): void;
  }
}
