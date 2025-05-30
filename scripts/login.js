document.getElementById("loginBtn").addEventListener("click", async () => {
	try {
		// const response = await fetch("http://127.0.0.1:4000/api/auth/twitter-login");

		// if (response.ok) {
		// 	const data = await response.json();
		// 	const redirectUrl = data.data.url;
		// 	const cacheId = data.data.cache_id;

		// 	chrome.storage.local.set({ twitter_cache_id: cacheId }, () => {
		// 		chrome.tabs.create({ url: redirectUrl });
		// 	});
		// } else {
		// 	console.error("❌ Login request failed:", response.status);
		// }
		const url = "http://127.0.0.1:3000/auth"
		chrome.tabs.create({ url: url });
	} catch (error) {
		console.error("❌ Error during login:", error);
	}
});
