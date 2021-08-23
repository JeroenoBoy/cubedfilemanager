import { ParsedArgs } from "minimist";
import RequestManager from "./lib/RequestsManager";
import SettingsManager from "./lib/SettingsManager";
import FileWatcher from './lib/FileWatcher';
import chalk from "chalk";
import inquirer from 'inquirer';
import CryptoHandler from "./lib/CryptoHandler";
import { LoginMethods } from "./types/LoginTypes";
import normalQuestion from "./questions/normalQuestion";
import hiddenQuestion from "./questions/hiddenQuestion";
import Utility from "./lib/Utility";

export default class CubedFileManager {

	public settingsManager: SettingsManager;
	public requestManager: RequestManager;
	public fileWatcher: FileWatcher;
	public cryptoManager: CryptoHandler;
	public utilities: Utility

	public rootDir: string
	public arguments: ParsedArgs;
	
	public sessionToken: string;
	public headers!: HeadersInit;
	public folderSupport: boolean = false;
	public logErrors: boolean = false;
	public username: string = "";
	public baseDir: string = "plugins/Skript/scripts";

	public temp_username: string | undefined;
	public temp_password: string | undefined;
	public temp_server: number | undefined;

	constructor(rootDir: string, args: ParsedArgs) {

		if (rootDir === ".") {
			this.rootDir = process.cwd();
		} else {
			this.rootDir = rootDir;
		}

		this.settingsManager = new SettingsManager(this);
		this.fileWatcher = new FileWatcher(this);
		this.requestManager = new RequestManager(this);
		this.cryptoManager = new CryptoHandler(this);
		this.utilities = new Utility(this);

		this.sessionToken = "";
		this.rootDir = rootDir;
		this.arguments = args;

		this.settingsManager.init();
		this.parseArguments();
		this.cryptoManager.init();

		this.init();
	}

	private parseArguments() {
		if (this.arguments.init) {
			this.settingsManager.createJsonFile();
			process.exit(0);
		}

		// Arguments used for stuff

		if (this.arguments.foldersupport || this.arguments.fs || this.settingsManager.settings?.folderSupport) {
			this.folderSupport = true;
		} 

		if (this.arguments.name || this.arguments.n || this.settingsManager.settings?.username) {
			this.username = (this.arguments.name || this.arguments.n);
		}

		if (this.arguments.logerrors || this.arguments.logerr || this.settingsManager.settings?.logErrors) {
			this.logErrors = true;
		}

		if (this.arguments.basedir || this.arguments.dir || this.settingsManager.settings?.baseDir) {
			this.baseDir = this.arguments.basedir || this.arguments.dir || this.settingsManager.settings?.baseDir!
			if (this.baseDir.startsWith('/')) this.baseDir = this.baseDir.slice(1, this.baseDir.length);
			if (this.baseDir.endsWith('/')) this.baseDir = this.baseDir.slice(0, this.baseDir.length - 1);
		}
	}

	private async init() : Promise<any> {

		/**
		 * Logging into their account & getting a session ID
		 */
		const loginMethod = await this.askLoginMethod();

		let username;
		let password;

		if (loginMethod == LoginMethods.MANUAL) {
			username = await normalQuestion('What is your username? ');
			password = await hiddenQuestion('What is your password? ');
		} else if (loginMethod == LoginMethods.AUTOMATIC || loginMethod == LoginMethods.RECONFIGURE) {
			username = this.cryptoManager.username;
			password = this.cryptoManager.password;
		}
		
		if (!username || !password) {
			this.message_error('No username or password was found. Please try again.');
			process.exit(0);
		}

		this.temp_username = username;
		this.temp_password = password;
		
		const response = await this.requestManager.login(username, password);
		if (response == null) {
			return this.init();
		}

		if (loginMethod == LoginMethods.MANUAL) {
			const choices = [
				"Yes",
				"No",
			];
			const { save_data } = await inquirer.prompt([
				{
					name: 'save_data',
					prefix: "",
					type: 'list',
					pageSize: 2,
					message: "Do you want to save your login details for future use?",
					loop: false,
					choices: choices
				}
			]);

			if (save_data == "Yes") {
				this.cryptoManager.username = username;
				this.cryptoManager.password = password;
				this.cryptoManager.updateStorage();
			}
		}
	
		this.sessionToken = response;
		this.headers = {
			cookie: `PHPSESSID=${response};`
		}

		/**
		 * Selecting a server to work on
		 */
		let server_selected = false;
		const servers_list = await this.requestManager.getServersInDashboard();
		if (this.settingsManager.settings?.server) {
			if (!servers_list.some(c => c.name.toLowerCase() == this.settingsManager.settings?.server?.toLowerCase())) {
				this.message_error("Specified server in CubedCraft.json was not found.");
			} else {
				const id = servers_list.find(c => c.name.toLowerCase() == this.settingsManager.settings?.server?.toLowerCase())?.id!
				this.requestManager.selectServer(id);
				this.temp_server = id;

				server_selected = true;
			}
		}	

		if (!server_selected) {
			const server_name = await inquirer.prompt([
				{
					name: "server_name",
					prefix: "",
					type: "list",
					pageSize: 5,
					message: "What server are you working on?",
					loop: false,
					choices: servers_list.map(c => c.name),
				},
			]).then((o: any) => o.server_name)

			const server = servers_list.find(c => c.name.toLowerCase() === server_name.toLowerCase());
			this.temp_server = server?.id!;
			this.requestManager.selectServer(server?.id!);
		}

		this.message_success(`Successfully selected a server to work on`);
		this.fileWatcher.init();
	}

	/**
	 * Questions
	 */

	private askLoginMethod(): Promise<LoginMethods> {
		return new Promise(async (resolve) => {
			if (this.cryptoManager.username.length < 1 || this.cryptoManager.password.length < 1) {
				resolve(LoginMethods.MANUAL);
				return;
			}

			const choices = [
				`Log in as ${this.cryptoManager.username}`,
				`Change username and password for auto log in`,
				`Log in manually`
			];

			const { startup_choice } = await inquirer.prompt([
				{
					name: 'startup_choice',
					prefix: "",
					type: 'list',
					pageSize: 3,
					message: "How would you like to start the system?",
					loop: false,
					choices: choices
				}
			]);

			if (startup_choice == "Change username and password for auto log in") {

				this.cryptoManager.username = await normalQuestion('What is your username? ');
				this.cryptoManager.password = await hiddenQuestion('What is your password? ');
				this.cryptoManager.updateStorage();

				resolve(LoginMethods.RECONFIGURE);

			} else if (startup_choice == `Log in as ${this.cryptoManager.username}`) {
				resolve(LoginMethods.AUTOMATIC)
			} else {
				resolve(LoginMethods.MANUAL);
			}
		})
	}


	/**
	 * Session verification
	 */

	public async check_session() {
		const expired = await this.requestManager.sessionIsExpired();
		if (expired) {
			this.message_info('Current session expired. Refreshing it!');
			if (!this.temp_server || !this.temp_password || !this.temp_username) {
				this.message_error('Failed to log back in. Exitting system.');
				process.exit(0);
			}
			const response = await this.requestManager.login(this.temp_username, this.temp_password);
			await this.requestManager.selectServer(this.temp_server);

			this.sessionToken = response!;
			this.headers = {
				cookie: `PHPSESSID=${response};`
			}
		}
	}


	/**
	 * Messages
	 */
	public message_success(msg: string) {
		console.log(chalk.grey('[') + chalk.greenBright("✓") + chalk.grey("]") + " " + msg);
	}

	public message_error(msg: string) {
		console.log(chalk.grey('[') + chalk.redBright("x") + chalk.grey("]") + " " + msg);
	}

	public message_info(msg: string) {
		console.log(chalk.grey('[') + chalk.yellowBright("*") + chalk.grey("]") + " " + msg);
	}

	public message_log(msg: string) {
		console.log(chalk.grey(`[ `) + chalk.blue(`${new Date(Date.now()).toLocaleTimeString()}`) + chalk.grey(' ]') + " " + msg);
	}
}