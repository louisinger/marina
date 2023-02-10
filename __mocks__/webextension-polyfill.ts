const Browser = {};
const mockStorage = new Map<string, any>();

const local = {
    get: jest.fn((keys: string[] | string | null) => {
        if (keys === null) { // return all
            return Promise.resolve(
                Array.from(mockStorage.entries()).reduce<Record<string, any>>((acc, [key, value]) => {
                    acc[key] = value;
                    return acc;
                }
                , {})
            );
        }
        if (typeof keys === 'string') {
            return Promise.resolve({
                [keys]: mockStorage.get(keys),
            });
        }
        return Promise.resolve(
            keys.reduce<Record<string, any>>((acc, key) => {
                acc[key] = mockStorage.get(key);
                return acc;
            }
            , {})
        );
    }),
    set: jest.fn((rec: Record<string, any>) => {
        Object.keys(rec).forEach((key) => {
            mockStorage.set(key, rec[key]);
        });
        return Promise.resolve();
    }),
    clear: jest.fn(() => {
        mockStorage.clear();
        return Promise.resolve();
    }),
};

// @ts-ignore
Browser.storage = {
    local,
};

export default Browser;