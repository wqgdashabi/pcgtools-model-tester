import { createApp } from 'vue'
import App from './App.vue'
import '@/styles/index.scss'
import '@/styles/debug.scss'
import naive from '@/plugins/naive-ui'

createApp(App).use(naive).mount('#app')
