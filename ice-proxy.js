const fs = require('fs');
const path = require('path');
const axios = require('axios');
const colors = require('colors');
const readline = require('readline');
const { DateTime } = require('luxon');
const { HttpsProxyAgent } = require('https-proxy-agent');
const headers = require("./src/header").default;
const printLogo = require("./src/logo");
const log = require('./src/logger');

class TelegramClient {
    constructor() {
        this.headers = headers;
        this.log = log;
        this.proxyList = [];
        this.loadProxies();
    }

    loadProxies() {
        try {
            const proxyFile = path.join(__dirname, 'proxy.txt');
            this.proxyList = fs.readFileSync(proxyFile, 'utf8')
                .replace(/\r/g, '')
                .split('\n')
                .filter(Boolean);
        } catch (error) {
            this.log('Unable to read proxy.txt file', 'error');
            this.proxyList = [];
        }
    }

    getAxiosConfig(index) {
        const config = {};
        if (this.proxyList.length > 0 && index < this.proxyList.length) {
            const proxyAgent = new HttpsProxyAgent(this.proxyList[index]);
            config.httpsAgent = proxyAgent;
        }
        return config;
    }

    async checkProxyIP(proxy) {
        try {
            const proxyAgent = new HttpsProxyAgent(proxy);
            const response = await axios.get('https://api.ipify.org?format=json', {
                httpsAgent: proxyAgent,
                timeout: 10000
            });
            if (response.status === 200) {
                return response.data.ip;
            } else {
                throw new Error(`Unable to check proxy IP. Status code: ${response.status}`);
            }
        } catch (error) {
            throw new Error(`Error checking proxy IP: ${error.message}`);
        }
    }

    async countdown(seconds) {
        for (let i = seconds; i > 0; i--) {
            const timestamp = new Date().toLocaleTimeString();
            readline.cursorTo(process.stdout, 0);
            process.stdout.write(`[${timestamp}] [*] Waiting ${i} seconds to continue...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        readline.cursorTo(process.stdout, 0);
        readline.clearLine(process.stdout, 0);
    }

    async getBalance(authData, axiosConfig) {
        const url = "https://0xiceberg.com/api/v1/web-app/balance/";
        const headers = {
            ...this.headers,
            "X-Telegram-Auth": authData
        };

        try {
            const response = await axios.get(url, { 
                headers,
                ...axiosConfig
            });
            if (response.status === 200) {
                return { success: true, data: response.data };
            } else {
                return { success: false, error: response.data };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async handleFarming(authData, axiosConfig) {
        const url = "https://0xiceberg.com/api/v1/web-app/farming/";
        const headers = {
            ...this.headers,
            "X-Telegram-Auth": authData
        };

        try {
            const checkResponse = await axios.get(url, { 
                headers,
                ...axiosConfig
            });
            
            if (checkResponse.status === 200) {
                if (Object.keys(checkResponse.data).length === 0) {
                    const startResponse = await axios.post(url, {}, { 
                        headers,
                        ...axiosConfig
                    });
                    if (startResponse.status === 200) {
                        const startTime = DateTime.fromISO(startResponse.data.start_time);
                        const stopTime = DateTime.fromISO(startResponse.data.stop_time);
                        const duration = stopTime.diff(startTime).toFormat('hh:mm:ss');
                        this.log(`Started new farming - Completion time: ${duration}`, 'success');
                    }
                } else {
                    const stopTime = DateTime.fromISO(checkResponse.data.stop_time);
                    const now = DateTime.now();
                    
                    if (stopTime < now) {
                        const collectUrl = "https://0xiceberg.com/api/v1/web-app/farming/collect/";
                        await axios.delete(collectUrl, { 
                            headers,
                            ...axiosConfig
                        });
                        this.log('Successfully harvested farm', 'success');

                        const startResponse = await axios.post(url, {}, { 
                            headers,
                            ...axiosConfig
                        });
                        if (startResponse.status === 200) {
                            const startTime = DateTime.fromISO(startResponse.data.start_time);
                            const newStopTime = DateTime.fromISO(startResponse.data.stop_time);
                            const duration = newStopTime.diff(startTime).toFormat('hh:mm:ss');
                            this.log(`Started new farming - Completion time: ${duration}`, 'success');
                        }
                    } else {
                        const timeLeft = stopTime.diff(now).toFormat('hh:mm:ss');
                        this.log(`Farming is running - Time left: ${timeLeft}`, 'info');
                    }
                }
                return { success: true };
            }
            return { success: false, error: "Failed to check farming status" };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async handleAdInteraction(authData, axiosConfig, retryCount = 0) {
        const MAX_RETRIES = 3;
        try {
            const userCheckUrl = "https://0xiceberg.com/api/v1/users/user/current-user/";
            const baseHeaders = {
                ...this.headers,
                "X-Telegram-Auth": authData
            };
    
            const userResponse = await axios.get(userCheckUrl, { 
                headers: baseHeaders,
                ...axiosConfig
            });
            if (userResponse.status !== 200) {
                throw new Error("Failed to fetch user data");
            }
    
            const { adsgram_counter, chat_id } = userResponse.data;
            
            if (adsgram_counter >= 20) {
                this.log("Reached the limit of ad views (20/20)", 'warning');
                return { success: false, reason: "limit_reached" };
            }
    
            this.log(`Current ad count: ${adsgram_counter}/20`, 'info');
    
            const adsgramHeaders = {
                ...this.headers,
                "Origin": "https://0xiceberg.com",
                "Sec-Fetch-Site": "cross-site",
            };
    
            const adUrl = `https://api.adsgram.ai/adv?blockId=3721&tg_id=${chat_id}&tg_platform=android&platform=Win32&language=vi&top_domain=0xiceberg.com`;
            const adResponse = await axios.get(adUrl, { 
                headers: adsgramHeaders,
                ...axiosConfig
            });
            
            if (adResponse.status !== 200) {
                throw new Error("Failed to fetch advertisement data");
            }
    
            const { trackings } = adResponse.data.banner;
            
            await axios.get(trackings.find(t => t.name === "render").value, {
                headers: adsgramHeaders,
                ...axiosConfig
            });

            await new Promise(resolve => setTimeout(resolve, 5000));
            await axios.get(trackings.find(t => t.name === "show").value, {
                headers: adsgramHeaders,
                ...axiosConfig
            });

            await new Promise(resolve => setTimeout(resolve, 10000));
            await axios.get(trackings.find(t => t.name === "reward").value, {
                headers: adsgramHeaders,
                ...axiosConfig
            });
    
            const verifyResponse = await axios.get(userCheckUrl, { 
                headers: baseHeaders,
                ...axiosConfig
            });
            if (verifyResponse.data.adsgram_counter !== adsgram_counter + 1) {
                throw new Error("Ad interaction was not counted properly");
            }
    
            this.log(`Ad Viewed Successfully. Viewed: ${verifyResponse.data.adsgram_counter}/20`, 'success');
            return { success: true, newCount: verifyResponse.data.adsgram_counter };
    
        } catch (error) {
            if (error.response?.status === 400 && retryCount < MAX_RETRIES) {
                this.log(`Attempt ${retryCount + 1} failed, retrying...`, 'warning');
                await new Promise(resolve => setTimeout(resolve, 2000));
                return this.handleAdInteraction(authData, axiosConfig, retryCount + 1);
            }
            
            this.log(`Ad Viewing Failed After ${retryCount + 1} Attempts: ${error.message}`, 'error');
            return { success: false, error: error.message };
        }
    }

    async handleTasks(authData, axiosConfig) {
        const url = "https://0xiceberg.com/api/v1/web-app/tasks/";
        const headers = {
            ...this.headers,
            "X-Telegram-Auth": authData
        };

        try {
            const tasksResponse = await axios.get(url, { 
                headers,
                ...axiosConfig
            });
            if (tasksResponse.status !== 200) {
                throw new Error("Failed to fetch tasks");
            }

            const newTasks = tasksResponse.data.filter(task => task.status === "new");

            for (const task of newTasks) {
                const taskUrl = `${url}task/${task.id}/`;
                
                const startResponse = await axios.patch(taskUrl, 
                    { status: "in_work" },
                    { 
                        headers,
                        ...axiosConfig
                    }
                );

                if (!startResponse.data.success) {
                    this.log(`Unable to start task ${task.id}`, 'error');
                    continue;
                }

                await new Promise(resolve => setTimeout(resolve, 5000));

                const readyResponse = await axios.patch(taskUrl,
                    { status: "ready_collect" },
                    { 
                        headers,
                        ...axiosConfig
                    }
                );

                if (!readyResponse.data.success) {
                    this.log(`Unable to complete task ${task.id}`, 'error');
                    continue;
                }

                const collectResponse = await axios.patch(taskUrl,
                    { status: "collected" },
                    { 
                        headers,
                        ...axiosConfig
                    }
                );

                if (collectResponse.data.success) {
                    this.log(`Successfully completed task ${task.description} | Reward: ${task.price}`, 'success');
                } else {
                    this.log(`Unable to collect reward for task ${task.id}`, 'error');
                }

                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            return { success: true };
        } catch (error) {
            this.log(`Error processing tasks: ${error.message}`, 'error');
            return { success: false, error: error.message };
        }
    }

    async main() {
        const dataFile = path.join(__dirname, 'data.txt');
        const data = fs.readFileSync(dataFile, 'utf8')
            .replace(/\r/g, '')
            .split('\n')
            .filter(Boolean);

        printLogo();

        while (true) {
            for (let i = 0; i < data.length; i++) {
                const authData = data[i];
                const userData = JSON.parse(decodeURIComponent(authData.split('user=')[1].split('&')[0]));
                const userId = userData.id;
                const firstName = userData.first_name;
                
                let proxyIP = "No proxy";
                const axiosConfig = this.getAxiosConfig(i);
                
                if (this.proxyList[i]) {
                    try {
                        proxyIP = await this.checkProxyIP(this.proxyList[i]);
                    } catch (error) {
                        this.log(`Error checking proxy IP: ${error.message}`, 'warning');
                        continue;
                    }
                }

                console.log(`========== Account ${i + 1} | ${firstName.green} | ip: ${proxyIP} ==========`);

                this.log(`Checking balance for account ${userId}...`, 'info');
                const balanceResult = await this.getBalance(authData, axiosConfig);
                
                if (balanceResult.success) {
                    this.log(`Balance: ${balanceResult.data.amount}`, 'success');
                    this.log(`Count reset: ${balanceResult.data.count_reset}`, 'info');
                } else {
                    this.log(`Unable to fetch balance: ${balanceResult.error}`, 'error');
                }

                this.log(`Checking farming status...`, 'info');
                const farmingResult = await this.handleFarming(authData, axiosConfig);
                if (!farmingResult.success) {
                    this.log(`Farming error: ${farmingResult.error}`, 'error');
                }

                this.log(`Checking tasks...`, 'info');
                const tasksResult = await this.handleTasks(authData, axiosConfig);
                if (!tasksResult.success) {
                    this.log(`Error processing tasks: ${tasksResult.error}`, 'error');
                }

                this.log(`Checking ads...`, 'info');
                while (true) {
                    const adResult = await this.handleAdInteraction(authData, axiosConfig);
                    if (!adResult.success) {
                        if (adResult.reason === "limit_reached") {
                            break;
                        }
                        this.log(`Error processing ads: ${adResult.error}`, 'error');
                        break;
                    }
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }

                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            await this.countdown(6 * 60);
        }
    }
}

const client = new TelegramClient();
client.main().catch(err => {
    client.log(err.message, 'error');
    process.exit(1);
});