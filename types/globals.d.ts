export { };

declare global {
    interface Window {
        electronAPI?: {
            send: (channel: string, ...args: any[]) => void;
            receive: (channel: string, callback: (...args: any[]) => void) => void;
            removeListener: (channel: string, callback: (...args: any[]) => void) => void;
        };
    }
}