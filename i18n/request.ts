import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async (context: any) => {
    const locale = context.req?.cookies?.locale || 'en'; // Default to 'en' if cookie is not set

    return {
        locale,
        messages: (await import(`../messages/${locale}.json`)).default
    };
});
