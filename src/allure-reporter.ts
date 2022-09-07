import {createHash} from 'crypto';
import * as os from 'os';
import {
	AllureGroup,
	AllureRuntime,
	AllureStep,
	AttachmentOptions,
	AllureTest,
	Category,
	ExecutableItemWrapper,
	LabelName,
	LinkType,
	Stage,
	Status
} from 'allure-js-commons';
import {parseWithComments} from 'jest-docblock';
import _ = require('lodash');
import prettier = require('prettier/standalone');
import parser = require('prettier/parser-typescript');

import type * as jest from '@jest/types';
import JestAllureInterface, {ContentType, Labels} from './jest-allure-interface';
import defaultCategories from './category-definitions';

export default class AllureReporter {
	currentExecutable: ExecutableItemWrapper | null = null;
	private readonly allureRuntime: AllureRuntime;
	private readonly suites: AllureGroup[] = [];
	private readonly steps: AllureStep[] = [];
	private readonly tests: AllureTest[] = [];
	private readonly jiraUrl: string;
	private readonly tmsUrl: string;
	private readonly categories: Category[] = defaultCategories;
	private readonly testNames: Array<String> = [];
	private readonly addCodeInReport: boolean = true
	labels: Labels[] = [];

	constructor(options: {
		allureRuntime: AllureRuntime;
		jiraUrl?: string;
		tmsUrl?: string;
		environmentInfo?: Record<string, string>;
		categories?: Category[];
		labels: Labels[];
		addCodeInReport?: boolean
	}) {
		this.allureRuntime = options.allureRuntime;

		this.jiraUrl = options.jiraUrl ?? 'https://github.com/c4lifa/jest-allure-circus/blob/master/README.md';

		this.tmsUrl = options.tmsUrl ?? 'https://github.com/c4lifa/jest-allure-circus/blob/master/README.md';

		if (options.environmentInfo) {
			this.allureRuntime.writeEnvironmentInfo(options.environmentInfo);
		}

		if (options.categories) {
			this.categories = [
				...this.categories,
				...options.categories
			];
		}

		if ('addCodeInReport' in options) {
			this.addCodeInReport = Boolean(options.addCodeInReport)
		}

		this.allureRuntime.writeCategoriesDefinitions(this.categories);
	}

	getImplementation(): JestAllureInterface {
		return new JestAllureInterface(this, this.allureRuntime, this.jiraUrl);
	}

	get currentSuite(): AllureGroup | null {
		return this.suites.length > 0 ? this.suites[this.suites.length - 1] : null;
	}

	get currentStep(): AllureStep | null {
		return this.steps.length > 0 ? this.steps[this.steps.length - 1] : null;
	}

	get currentTest(): AllureTest | null {
		return this.tests.length > 0 ? this.tests[this.tests.length - 1] : null;
	}

	environmentInfo(info?: Record<string, string>) {
		this.allureRuntime.writeEnvironmentInfo(info);
	}

	startTestFile(suiteName?: string): void {
		this.startSuite(suiteName);
	}

	endTestFile(): void {
		for (const _ of this.suites) {
			this.endSuite();
		}
	}

	startSuite(suiteName?: string, tests?: Array<Record<string, string>> | null): void {
		const scope: AllureGroup | AllureRuntime = this.currentSuite ?? this.allureRuntime;
		const suite: AllureGroup = scope.startGroup(suiteName ?? 'Global');
		this.pushSuite(suite);
		if (tests) {
			for(let i=0;i<=tests.length-1;i++) {
				this.testNames.push(tests[i].name);
			}
		}
	}

	endSuite(): void {
		if (this.currentSuite === null) {
			throw new Error('endSuite called while no suite is running');
		}

		if (this.steps.length > 0) {
			for (const step of this.steps) {
				step.endStep();
			}
		}

		if (this.tests.length > 0) {
			for (const test of this.tests) {
				test.endTest();
			}
		}

		this.currentSuite.endGroup();
		this.popSuite();
	}

	startHook(type: jest.Circus.HookType): void {
		const suite: AllureGroup | null = this.currentSuite;

		if (suite && type.startsWith('before')) {
			this.currentExecutable = suite.addBefore();
		}

		if (suite && type.startsWith('after')) {
			this.currentExecutable = suite.addAfter();
		}
	}

	endHook(error?: Error): void {
		if (this.currentExecutable === null) {
			throw new Error('endHook called while no executable is running');
		}

		if (error) {
			const {status, message, trace} = this.handleError(error);

			this.currentExecutable.status = status;
			this.currentExecutable.statusDetails = {message, trace};
			this.currentExecutable.stage = Stage.FINISHED;
		}

		if (!error) {
			this.currentExecutable.status = Status.PASSED;
			this.currentExecutable.stage = Stage.FINISHED;
		}
	}

	startTestCase(test: jest.Circus.TestEntry, state: jest.Circus.State, testPath: string): void {
		if (this.currentSuite === null) {
			throw new Error('startTestCase called while no suite is running');
		}
		let currentTest = this.currentSuite.startTest(test.name);
		currentTest.fullName = test.name;
		currentTest.historyId = createHash('md5')
			.update(testPath + '.' + test.name)
			.digest('hex');
		currentTest.stage = Stage.RUNNING;

		if (this.addCodeInReport) {
			if (test.fn) {
				const serializedTestCode = test.fn.toString();
				const {comments, pragmas, code} = this.extractCodeDetails(serializedTestCode);

				this.setAllureReportPragmas(currentTest, pragmas);

				currentTest.description = `${comments}\n### Test\n\`\`\`typescript\n${code[0]}\n\`\`\`\n`;
			} else {
				currentTest.description = '### Test\nCode is not available.\n';
			}
		}

		if (state.parentProcess?.env?.JEST_WORKER_ID) {
			currentTest.addLabel(LabelName.THREAD, state.parentProcess.env.JEST_WORKER_ID);
		}

		currentTest = this.addSuiteLabelsToTestCase(currentTest, testPath);
		this.pushTest(currentTest);
	}

	passTestCase(): void {
		if (this.currentTest === null) {
			throw new Error('passTestCase called while no test is running');
		}

		this.attachLabelsInConcurrent(this.currentTest, this.labels);
		this.currentTest.status = Status.PASSED;
	}

	pendingTestCase(test: jest.Circus.TestEntry): void {
		if (this.currentTest === null) {
			throw new Error('pendingTestCase called while no test is running');
		}

		this.attachLabelsInConcurrent(this.currentTest, this.labels);
		this.currentTest.status = Status.SKIPPED;
		this.currentTest.statusDetails = {message: `Test is marked: "${test.mode as string}"`};
	}

	failTestCase(error: Error | any): void {
		if (this.currentTest === null) {
			throw new Error('failTestCase called while no test is running');
		}

		this.attachLabelsInConcurrent(this.currentTest, this.labels);
		const latestStatus = this.currentTest.status;

		// If test already has a failed/broken state, we should not overwrite it
		const isBrokenTest = latestStatus === Status.BROKEN && this.currentTest.stage !== Stage.RUNNING;
		if (latestStatus === Status.FAILED || isBrokenTest) {
			return;
		}

		const {status, message, trace} = this.handleError(error);

		this.currentTest.status = status;
		this.currentTest.statusDetails = {message, trace};
	}

	endTest() {
		if (this.currentTest === null) {
			throw new Error('endTest called while no test is running');
		}

		this.currentTest.stage = Stage.FINISHED;
		this.currentTest.endTest();
		this.popTest();
	}

	writeAttachment(content: Buffer | string, type: ContentType | string | AttachmentOptions): string {
		if (type === ContentType.HTML) {
			// Allure-JS-Commons does not support HTML so we workaround this by providing the file extension.
			return this.allureRuntime.writeAttachment(content, {
				contentType: type,
				fileExtension: 'html'
			});
		}

		return this.allureRuntime.writeAttachment(content, type);
	}

	pushStep(step: AllureStep): void {
		this.steps.push(step);
	}

	popStep(): void {
		this.steps.pop();
	}

	pushTest(test: AllureTest): void {
		this.tests.push(test);
	}

	popTest(): void {
		this.tests.pop();
	}

	pushSuite(suite: AllureGroup): void {
		this.suites.push(suite);
	}

	popSuite(): void {
		this.suites.pop();
	}

	private handleError(error: Error | any) {
		var _a;
		if (Array.isArray(error)) {
			// Test_done event sends an array of arrays containing errors.
			error = _.flattenDeep(error)[0];
		}
		let status = Status.BROKEN;
		let message = error.name;
		let trace = error.stack || error.message;
		if (error.matcherResult) {
			status = Status.FAILED;
			const matcherMessage = typeof error.matcherResult.message === 'function' ? error.matcherResult.message() : error.matcherResult.message;
			const [line1, line2, ...restOfMessage] = matcherMessage.split('\n');
			message = [line1, line2].join('\n');
			trace = error.stack || restOfMessage.join('\n');
		}
		if (!message && trace) {
			message = trace;
			trace = (_a = error.stack) === null || _a === void 0 ? void 0 : _a.replace(message, 'No stack trace provided');
		}
		if (trace === null || trace === void 0 ? void 0 : trace.includes(message)) {
			trace = trace === null || trace === void 0 ? void 0 : trace.replace(message, '');
		}
		if (!message) {
			message = 'Error. Expand for more details.';
			trace = error;
		}
		return {
			status,
			message: this.replaceANSITags(message),
			trace: this.replaceANSITags(trace)
		};
	}

	private extractCodeDetails(serializedTestCode: string) {
		const docblock = this.extractDocBlock(serializedTestCode);
		const {pragmas, comments} = parseWithComments(docblock);

		let code = [serializedTestCode.replace(docblock, '')];

		// Add newline before the first expect()
		code = code[0].split(/(expect[\S\s.]*)/g)
		const check = code[0].includes('wait_for_') ? '' : '\n'
		code = [code.join(check)];
		code = [prettier.format(code[0], {parser: 'typescript', plugins: [parser]})];

		return {comments, pragmas, code};
	}

	private extractDocBlock(contents: string): string {
		const docblockRe = /^\s*(\/\*\*?(.|\r?\n)*?\*\/)/gm;

		const match = contents.match(docblockRe);
		return match ? match[0].trimStart() : '';
	}

	private setAllureReportPragmas(currentTest: AllureTest, pragmas: Record<string, string | string[]>) {
		for (let [pragma, value] of Object.entries(pragmas)) {
			if (value instanceof String && value.includes(',')) {
				value = value.split(',');
			}

			if (Array.isArray(value)) {
				for (const v of value) {
					this.setAllureLabelsAndLinks(currentTest, pragma, v);
				}
			}

			if (!Array.isArray(value)) {
				this.setAllureLabelsAndLinks(currentTest, pragma, value);
			}
		}
	}

	private setAllureLabelsAndLinks(currentTest: AllureTest, labelName: string, value: string, index?: number) {
		// @ts-expect-error (ts(2341))
		if (index === undefined || currentTest.info.name === this.testNames[index]) {
			switch (labelName) {
				case 'issue':
					currentTest.addLink(`${this.jiraUrl}${value}`, value, LinkType.ISSUE);
					break;
				case 'tms':
					currentTest.addLink(`${this.tmsUrl}${value}`, value, LinkType.TMS);
					break;
				case 'tag':
				case 'tags':
					currentTest.addLabel(LabelName.TAG, value);
					break;
				case 'milestone':
					currentTest.addLabel(labelName, value);
					currentTest.addLabel('epic', value);
					break;
				default:
					currentTest.addLabel(labelName, value);
					break;
			}
		}
	}

	private addSuiteLabelsToTestCase(currentTest: AllureTest, testPath: string): AllureTest {
		const isWindows = os.type() === 'Windows_NT';
		const pathDelimiter = isWindows ? '\\' : '/';
		const pathsArray = testPath.split(pathDelimiter);

		const [parentSuite, ...suites] = pathsArray;
		const subSuite = suites.pop();

		if (parentSuite) {
			currentTest.addLabel(LabelName.PARENT_SUITE, parentSuite);
			currentTest.addLabel(LabelName.PACKAGE, parentSuite);
		}

		if (suites.length > 0) {
			currentTest.addLabel(LabelName.SUITE, suites.join(' > '));
		}

		if (subSuite) {
			currentTest.addLabel(LabelName.SUB_SUITE, subSuite);
		}

		return currentTest;
	}

	private attachLabelsInConcurrent(currentTest: AllureTest, labels: Labels[]) {
		if (labels) {
			let set = new Set(labels);
			let arr = Array.from(set);
			for (let i=0;i<=arr.length-1;i++) {
				this.setAllureLabelsAndLinks(currentTest, arr[i].name, arr[i].value, arr[i].index);
			}
		}
	}

	// TODO: Use if describe blocks are present.
	private collectTestParentNames(
		parent: jest.Circus.TestEntry | jest.Circus.DescribeBlock | undefined
	) {
		const testPath = [];
		do {
			testPath.unshift(parent?.name);
		} while ((parent = parent?.parent));

		return testPath;
	}

	private replaceANSITags(entry: string) {
		
		return entry.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
	}
}
