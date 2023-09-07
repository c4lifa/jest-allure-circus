import {basename} from 'path';
import {AllureRuntime, AllureConfig} from 'allure-js-commons';
import type {Circus} from '@jest/types';

import type {EnvironmentContext, JestEnvironment} from '@jest/environment';
import AllureReporter from './allure-reporter';
import type {Labels} from './jest-allure-interface';

function extendAllureBaseEnvironment<TBase extends typeof JestEnvironment>(Base: TBase): TBase {
	// @ts-expect-error (ts(2545)) Incorrect assumption about a mixin class: https://github.com/microsoft/TypeScript/issues/37142
	return class AllureBaseEnvironment extends Base {
		global: any;
		private readonly reporter: AllureReporter;
		private readonly testPath: string;
		private readonly testFileName: string;

		constructor(config: any, context: EnvironmentContext) {
			super(config, context);
			const parentHandleTestEvent = Reflect.get(this, 'handleTestEvent');
            this.handleTestEvent = async (event, state) => {
                var _a;
                // @ts-ignore
                await parentHandleTestEvent?.call(this, event, state);
                switch (event.name) {
                    case 'setup':
                        break;
                    case 'add_hook':
                        break;
                    case 'add_test':
                        break;
                    case 'run_start':
                        this.reporter.startTestFile(this.testFileName);
                        break;
                    case 'test_skip':
                        this.reporter.startTestCase(event.test, state, this.testPath);
                        this.reporter.pendingTestCase(event.test);
                        break;
                    case 'test_todo':
                        this.reporter.startTestCase(event.test, state, this.testPath);
                        this.reporter.pendingTestCase(event.test);
                        break;
                    case 'start_describe_definition':
                        /**
                         * @privateRemarks
                         * Only called if "describe()" blocks are present.
                         */
                        break;
                    case 'finish_describe_definition':
                        /**
                         * @privateRemarks
                         * Only called if "describe()" blocks are present.
                         */
                        break;
                    case 'run_describe_start':
                        /**
                         * @privateRemarks
                         * This is called at the start of a test file.
                         * Even if there are no describe blocks.
                         */
						// @ts-expect-error (ts(2345))
                        this.reporter.startSuite(event.describeBlock.name, event.describeBlock.tests);
                        break;
                    case 'test_start':
                        /**
                         * @privateRemarks
                         * This is called after beforeAll and before the beforeEach hooks.
                         * If we start the test case here, allure will include the beforeEach
                         * hook as part of the "test body" instead of the "Set up".
                         */
                        // This.reporter.startTestCase(event.test, state, this.testPath);
                        break;
                    case 'hook_start':
                        this.reporter.startHook(event.hook.type);
                        break;
                    case 'hook_success':
                        this.reporter.endHook();
                        break;
                    case 'hook_failure':
                        this.reporter.endHook((_a = event.error) !== null && _a !== void 0 ? _a : event.hook.asyncError);
                        break;
                    case 'test_fn_start':
                        /**
                         * @privateRemarks
                         * This is called after the beforeAll and after the beforeEach.
                         * Making this the most reliable event to start the test case, so
                         * that only the test context is captured in the allure
                         * "Test body" execution.
                         */
                        this.reporter.startTestCase(event.test, state, this.testPath);
                        break;
                    case 'test_fn_success':
                        if (event.test.errors.length > 0) {
                            this.reporter.failTestCase(event.test.errors[0]);
                        }
                        else {
                            this.reporter.passTestCase();
                        }
                        break;
                    case 'test_fn_failure':
                        this.reporter.failTestCase(event.test.errors[0]);
                        break;
                    case 'test_done':
                        /**
                         * @privateRemarks
                         * This is called once the test has completed (includes hooks).
                         * This is more reliable for error collection because some failures
                         * like Snapshot failures will only appear in this event.
                         */
                        /**
                         * @privateRemarks -Issue-
                         * If we capture errors from both test_done and test_fn_failure
                         * the test case will be overriden causing allure to lose any
                         * test context like steps that the overriden test case may have
                         * had.
                         * A workaround might be to refactor the AllureReporter class
                         * by decoupling the endTestCase method from the passTestCase,
                         * failTestCase, and pendingTestCase methods.
                         */
                        /**
                         * @privateRemarks -Issue-
                         * afterEach hooks appears in the allure "test body".
                         */
                        if (event.test.errors.length > 0) {
                            this.reporter.failTestCase(event.test.errors[0]);
                        }
                        this.reporter.endTest();
                        break;
                    case 'run_describe_finish':
                        /**
                         * @privateRemarks
                         * This is called at the end of a describe block or test file. If a
                         * describe block is not present in the test file, this event will
                         * still be called at the end of the test file.
                         */
                        this.reporter.endSuite();
                        break;
                    case 'run_finish':
                        this.reporter.endTestFile();
                        break;
                    case 'teardown':
                        break;
                    case 'error':
                        /**
                         * @privateRemarks
                         * Haven't found a good example of when this is emitted yet.
                         */
                        // console.log('ERROR EVENT:', event);
                        break;
                    default:
                        /**
                         * @privateRemarks
                         * Haven't found a good example of when this is emitted yet.
                        */
                        // console.log('UNHANDLED EVENT:', event);
                        break;
                }
            };

			if (typeof config.projectConfig.testEnvironmentOptions.testPath === 'string') {
				this.testPath = config.projectConfig.testEnvironmentOptions.testPath;
			}

			this.testPath = this.initializeTestPath(config, context);

			this.testFileName = basename(this.testPath);

			this.reporter = this.initializeAllureReporter(config);

			this.global.allure = this.reporter.getImplementation();
		}

		initializeTestPath(config: any, context: EnvironmentContext) {
			let testPath = context?.testPath ?? '';

			if (typeof config.projectConfig.testEnvironmentOptions.testPath === 'string') {
				testPath = testPath?.replace(config.projectConfig.testEnvironmentOptions.testPath, '');
			}

			if (typeof config.projectConfig.testEnvironmentOptions.testPath !== 'string') {
				testPath = testPath?.replace(config.rootDir, '');
			}

			if (testPath.startsWith('/')) {
				testPath = testPath.slice(1);
			}

			return testPath;
		}

		initializeAllureReporter(config: any) {
			const allureConfig: AllureConfig = {
				resultsDir: config.projectConfig.testEnvironmentOptions.resultsDir as string ?? 'allure-results',
			};

			return new AllureReporter({
				allureRuntime: new AllureRuntime(allureConfig),
				jiraUrl: config.projectConfig.testEnvironmentOptions?.jiraUrl as string,
				tmsUrl: config.projectConfig.testEnvironmentOptions?.tmsUrl as string,
				environmentInfo: config.projectConfig.testEnvironmentOptions?.environmentInfo as Record<string, any>,
				categories: config.projectConfig.testEnvironmentOptions?.categories as Array<Record<string, any>>,
				labels: [] as Labels[],
			});
		}

		async setup() {
			return super.setup();
		}

		async teardown() {
			return super.teardown();
		}
	}
}

export default extendAllureBaseEnvironment;