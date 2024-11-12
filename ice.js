const fs = require('fs');
const path = require('path');
const axios = require('axios');
const colors = require('colors');
const readline = require('readline');
const { DateTime } = require('luxon');
const headers = require("./src/header").default;
const printLogo = require("./src/logo");
const log = require('./src/logger');

class TelegramClient {
    constructor() {
        this.headers = headers;
        this.log = log;
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

    async getBalance(authData) {
        const url = "https://0xiceberg.com/api/v1/web-app/balance/";
        const headers = {
            ...this.headers,
            "X-Telegram-Auth": authData
        };

        try {
            const response = await axios.get(url, { headers });
            if (response.status === 200) {
                return { success: true, data: response.data };
            } else {
                return { success: false, error: response.data };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async handleFarming(authData) {
        const url = "https://0xiceberg.com/api/v1/web-app/farming/";
        const headers = {
            ...this.headers,
            "X-Telegram-Auth": authData
        };

        try {
            const checkResponse = await axios.get(url, { headers });
            
            if (checkResponse.status === 200) {
                if (Object.keys(checkResponse.data).length === 0) {
                    const startResponse = await axios.post(url, {}, { headers });
                    if (startResponse.status === 200) {
                        const startTime = DateTime.fromISO(startResponse.data.start_time);
                        const stopTime = DateTime.fromISO(startResponse.data.stop_time);
                        const duration = stopTime.diff(startTime).toFormat('hh:mm:ss');
                        this.log(`Started new farm - Completion time: ${duration}`, 'success');
                    }
                } else {
                    const stopTime = DateTime.fromISO(checkResponse.data.stop_time);
                    const now = DateTime.now();
                    
                    if (stopTime < now) {
                        const collectUrl = "https://0xiceberg.com/api/v1/web-app/farming/collect/";
                        await axios.delete(collectUrl, { headers });
                        this.log('Farm collection successful', 'success');

                        const startResponse = await axios.post(url, {}, { headers });
                        if (startResponse.status === 200) {
                            const startTime = DateTime.fromISO(startResponse.data.start_time);
                            const newStopTime = DateTime.fromISO(startResponse.data.stop_time);
                            const duration = newStopTime.diff(startTime).toFormat('hh:mm:ss');
                            this.log(`Started new farm - Completion time: ${duration}`, 'success');
                        }
                    } else {
                        const timeLeft = stopTime.diff(now).toFormat('hh:mm:ss');
                        this.log(`Farm in progress - Time remaining: ${timeLeft}`, 'info');
                    }
                }
                return { success: true };
            }
            return { success: false, error: "Failed to check farming status" };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async handleAdInteraction(authData, retryCount = 0) {
        const MAX_RETRIES = 3;
        try {
            const userCheckUrl = "https://0xiceberg.com/api/v1/users/user/current-user/";
            const baseHeaders = {
                ...this.headers,
                "X-Telegram-Auth": authData
            };
    
            const userResponse = await axios.get(userCheckUrl, { headers: baseHeaders });
            if (userResponse.status !== 200) {
                throw new Error("Failed to fetch user data");
            }
    
            const { adsgram_counter, chat_id } = userResponse.data;
            
            if (adsgram_counter >= 20) {
                this.log("Ad view limit reached (20/20)", 'warning');
                return { success: false, reason: "limit_reached" };
            }
    
            this.log(`Current ad count: ${adsgram_counter}/20`, 'info');
    

            const adsgramHeaders = {
                "Accept": "*/*",
                "Accept-Encoding": "gzip, deflate, br",
                "Accept-Language": "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
                "Cache-Control": "max-age=0",
                "Connection": "keep-alive",
                "Origin": "https://0xiceberg.com",
                "Referer": "https://0xiceberg.com/",
                "Sec-Ch-Ua": '"Not/A)Brand";v="99", "Google Chrome";v="115", "Chromium";v="115"',
                "Sec-Ch-Ua-Mobile": "?0",
                "Sec-Ch-Ua-Platform": '"Windows"',
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "cross-site",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
            };
    
            const adUrl = `https://api.adsgram.ai/adv?blockId=3721&tg_id=${chat_id}&tg_platform=android&platform=Win32&language=vi&top_domain=0xiceberg.com`;
            const adResponse = await axios.get(adUrl, { 
                headers: adsgramHeaders
            });
            
            if (adResponse.status !== 200) {
                throw new Error("Failed to fetch advertisement data");
            }
    
            const { trackings } = adResponse.data.banner;
            
            await axios.get(trackings.find(t => t.name === "render").value, {
                headers: adsgramHeaders
            });

            await new Promise(resolve => setTimeout(resolve, 5000));
            await axios.get(trackings.find(t => t.name === "show").value, {
                headers: adsgramHeaders
            });

            await new Promise(resolve => setTimeout(resolve, 10000));
            await axios.get(trackings.find(t => t.name === "reward").value, {
                headers: adsgramHeaders
            });
    
            const verifyResponse = await axios.get(userCheckUrl, { headers: baseHeaders });
            if (verifyResponse.data.adsgram_counter !== adsgram_counter + 1) {
                throw new Error("Ad interaction was not counted properly");
            }
    
            this.log(`Ad viewed successfully. Viewed: ${verifyResponse.data.adsgram_counter}/20`, 'success');
            return { success: true, newCount: verifyResponse.data.adsgram_counter };
    
        } catch (error) {
            if (error.response?.status === 400 && retryCount < MAX_RETRIES) {
                this.log(`Attempt ${retryCount + 1} failed, retrying...`, 'warning');
                await new Promise(resolve => setTimeout(resolve, 2000));
                return this.handleAdInteraction(authData, retryCount + 1);
            }
            
            this.log(`Ad view failed after ${retryCount + 1} attempts: ${error.message}`, 'error');
            return { success: false, error: error.message };
        }
    }

    async handleTasks(authData) {
        const url = "https://0xiceberg.com/api/v1/web-app/tasks/";
        const headers = {
            ...this.headers,
            "X-Telegram-Auth": authData
        };

        try {
            const tasksResponse = await axios.get(url, { headers });
            if (tasksResponse.status !== 200) {
                throw new Error("Failed to fetch tasks");
            }

            const newTasks = tasksResponse.data.filter(task => task.status === "new");

            for (const task of newTasks) {
                const taskUrl = `${url}task/${task.id}/`;
                
                const startResponse = await axios.patch(taskUrl, 
                    { status: "in_work" },
                    { headers }
                );

                if (!startResponse.data.success) {
                    this.log(`Cannot start task ${task.id}`, 'error');
                    continue;
                }

                await new Promise(resolve => setTimeout(resolve, 5000));

                const readyResponse = await axios.patch(taskUrl,
                    { status: "ready_collect" },
                    { headers }
                );

                if (!readyResponse.data.success) {
                    this.log(`Cannot complete task ${task.id}`, 'error');
                    continue;
                }

                const collectResponse = await axios.patch(taskUrl,
                    { status: "collected" },
                    { headers }
                );

                if (collectResponse.data.success) {
                    this.log(`Task ${task.description} completed successfully | Reward: ${task.price}`, 'success');
                } else {
                    this.log(`Cannot collect reward for task ${task.id}`, 'error');
                }

                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            return { success: true };
        } catch (error) {
            this.log(`Task handling error: ${error.message}`, 'error');
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

                console.log(`========== Account ${i + 1} | ${firstName.green} ==========`);

                this.log(`Checking account ${userId} balance...`, 'info');
                const balanceResult = await this.getBalance(authData);
                
                if (balanceResult.success) {
                    this.log(`Balance: ${balanceResult.data.amount}`, 'success');
                    this.log(`Count reset: ${balanceResult.data.count_reset}`, 'info');
                } else {
                    this.log(`Cannot retrieve balance: ${balanceResult.error}`, 'error');
                }

                this.log(`Checking farming status...`, 'info');
                const farmingResult = await this.handleFarming(authData);
                if (!farmingResult.success) {
                    this.log(`Farming error: ${farmingResult.error}`, 'error');
                }

                this.log(`Checking tasks...`, 'info');
                const tasksResult = await this.handleTasks(authData);
                if (!tasksResult.success) {
                    this.log(`Task handling error: ${tasksResult.error}`, 'error');
                }

                this.log(`Checking ads...`, 'info');
                while (true) {
                    const adResult = await this.handleAdInteraction(authData);
                    if (!adResult.success) {
                        if (adResult.reason === "limit_reached") {
                            break;
                        }
                        this.log(`Ad handling error: ${adResult.error}`, 'error');
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
