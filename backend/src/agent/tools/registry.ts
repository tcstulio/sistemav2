import getReportHtml from './getReportHtml';
import getReportScreenshot from './getReportScreenshot';

export interface ReportTool {
    name: string;
    description: string;
    execute: (args: unknown) => string;
}

export const reportToolMap: Record<string, ReportTool> = {
    get_report_screenshot: getReportScreenshot,
    get_report_html: getReportHtml,
};

export const reportTools = Object.values(reportToolMap);

export default reportToolMap;
