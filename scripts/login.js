document.getElementById("loginBtn").addEventListener("click", async () => {
	try {
		const response = await fetch(
			"http://127.0.0.1:4000/api/auth/twitter-login",
		);

		if (response.ok) {
			const data = await response.json();
			const redirectUrl = data.data.url;
			const cacheId = data.data.cache_id;

			console.log("Redirecting to:", redirectUrl);
			console.log("Cache ID:", cacheId);

			// Store the cache_id in Chrome's local storage
			chrome.storage.local.set({ twitter_cache_id: cacheId }, () => {
				console.log("Cache ID stored successfully");

				// Open Twitter OAuth in a new tab
				chrome.tabs.create({ url: redirectUrl });
			});
		} else {
			console.error("Login request failed:", response.status);
		}
	} catch (error) {
		console.error("Error during login:", error);
	}
});
