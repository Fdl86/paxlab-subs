export function readTextFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file, 'utf-8');
    });
}
export function downloadText(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}
export async function fetchSample(path) {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok)
        throw new Error(`Impossible de charger ${path}`);
    return response.text();
}
export async function fetchSampleBlob(path) {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok)
        throw new Error(`Impossible de charger ${path}`);
    return response.blob();
}
